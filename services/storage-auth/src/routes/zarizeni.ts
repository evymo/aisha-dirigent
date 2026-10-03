import type { FastifyPluginAsync, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PassThrough, Readable } from 'node:stream';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeRateLimit } from '@aisha/security';
import { config } from '../config.js';
import { verifyToken, AuthError, isAdminOrStaff, type VerifiedUser } from '../auth.js';
import { getObjectStream, getObjectRange, putObjectStream, statObjectOrNull, vypisKlice, zajistiBucket } from '../minio.js';
import { prectiRozsah } from '../lib/rozsah.js';
import { PREFIX_ZADOSTI, VadnaZadost, klicZadosti, nejnovejsi, novaZadost, prectiVstup, type ZadostHlidace } from '../lib/zadosti.js';
import { checksumQr, klicApk, klicAppky, type StavZarizeni } from '../lib/zarizeni.js';
import {
  MAX_TELO_BAJTU,
  MAX_ZARIZENI,
  PREFIX_HLASENI,
  VadneHlaseni,
  klicHlaseni,
  prectiHlaseni,
  ulozitelne,
  type UlozeneHlaseni,
} from '../lib/hlaseni.js';
import { DeklaraceNedostupna, deklaraceZDb, type ZdrojDeklarace } from '../lib/zdroj-deklarace.js';
import { HlidanyProud, PrilisVelke, SpatnyZacatek, vedTelo, zahodZbytek } from '../lib/hlidany-proud.js';

/**
 * Schopnost „zařízení“: hlídač (device owner kiosku) pro tablety instance.
 *
 *   GET /zarizeni/konfigurace — admin/staff: je schopnost zapnutá, identita
 *       hlídače pro QR, adresa ke stažení, co je nahrané.
 *   PUT /zarizeni/hlidac      — admin/staff: nahraje APK hlídače (proud, ≤ 20 MB).
 *   POST /zarizeni/zadosti    — admin/staff: uloží, co šlo do QR (bez hesla k Wi-Fi).
 *   GET /zarizeni/zadosti     — admin/staff: posledních 50 žádostí, nejnovější první.
 *   GET /zarizeni/hlidac.apk  — BEZ přihlášení: tablet ho stahuje při nastavení
 *       z QR, kdy ještě nikoho nezná. Leží za dveřmi (API), které technik otevře
 *       z nastavovací sítě; pravost ověřuje tablet sám otiskem podpisu z QR.
 *
 * Vypnutá schopnost (instance ji nedeklarovala) = 200 `zapnuto:false` pro
 * administraci a 404 `not_configured` pro stažení — žádná půlka nefunguje
 * napůl.
 */
const APK_TYP = 'application/vnd.android.package-archive';
/** APK je ZIP: `PK\x03\x04`. Cokoli jiného se do bucketu nepustí. */
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Odkud se deklarace zařízení bere — JEDEN zdroj (lib/zdroj-deklarace.ts). */
// ⛔ ZDROJ VYBÍRÁ VERZE KÓDU, ne proměnná prostředí (brána `zadny-fallback-nad-
//    identitou`: dosazený výchozí literál v compose HÁDÁ). Od téhle verze databáze:
//    zapisuje ji hák dat instance při nasazení core, takže novou deklaraci (i tu,
//    kterou do dat instance zapíše CI „Kiosk: balíčky z CI“) storage-auth uvidí bez
//    přenasazení. Env `ZARIZENI_HLIDAC` a jeho derivace doktorem odešly v TÉMŽE PR
//    — shoda DB == env byla před přepnutím změřena v provozu.
export function zdrojDeklarace(): ZdrojDeklarace {
  return deklaraceZDb({ postgrestUrl: config.postgrestUrl, token: config.postgrestServiceToken });
}

export function stavZarizeni(): Promise<StavZarizeni> {
  return zdrojDeklarace().nacti();
}

async function adminUzivatel(req: FastifyRequest, reply: FastifyReply): Promise<VerifiedUser | null> {
  try {
    const user = await verifyToken(req.headers.authorization);
    if (isAdminOrStaff(user)) return user;
    reply.status(403).send({ error: 'forbidden' });
    return null;
  } catch (err) {
    if (err instanceof AuthError) {
      reply.status(err.statusCode).send({ error: err.message });
      return null;
    }
    throw err;
  }
}

async function admin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return (await adminUzivatel(req, reply)) !== null;
}

async function prectiJson(klic: string): Promise<unknown> {
  const c: Buffer[] = [];
  for await (const x of await getObjectStream(config.zarizeniBucket, klic)) c.push(x as Buffer);
  return JSON.parse(Buffer.concat(c).toString('utf8'));
}

export const zarizeniRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addContentTypeParser(APK_TYP, (_req, _payload, done) => done(null));

  // ⛔ Deklarace NEODPOVĚDĚLA ≠ „vypnuto“. Kiosk dostane 503 a v tu noc nic
  //    neinstaluje (to umí); administrace vidí, že zdroj chybí, ne že schopnost
  //    zmizela. Stará pravda odjinud by byla horší než žádná. Platí jen pro trasy
  //    tohoto pluginu (Fastify zapouzdření), ostatní chyby jdou dál beze změny.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DeklaraceNedostupna) {
      req.log.error({ err: err.message }, 'deklarace zařízení nedostupná');
      return reply.status(503).header('Retry-After', '60').send({ error: 'declaration_unavailable' });
    }
    return reply.send(err);
  });

  /**
   * Vydá balíček — celý, nebo jeho ČÁST podle `Range`.
   *
   * ⛔ PROČ PO ČÁSTECH (naměřeno 2026-09-22). Cesta ven má strop ~60 s na délku
   * požadavku a APK řidiče se stahovalo rychlostí 50 kB/s: z 52 MB dorazilo za
   * 300 s jen 15 MB. Jedním stažením to tablet NEDOSTANE. A přenos po LTE se
   * navíc trhá — bez navazování začíná pokaždé od nuly a ke konci se nedostane.
   *
   * ⛔ `Accept-Ranges` se hlásí VŽDY, i u plné odpovědi: klient se jinak nemá
   *    podle čeho rozhodnout, že smí navazovat, a zůstane u jednoho dlouhého
   *    požadavku, který na strop narazí.
   * ⛔ Chybný rozsah je 416 s `Content-Range: bytes * /velikost`, ne tiše
   *    posunutý kus: ten by se složil do souboru, jehož otisk nesedí — a hledalo
   *    by se to v buildu, ne v přenosu.
   */
  async function vydejBalicek(
    req: FastifyRequest,
    reply: FastifyReply,
    klic: string,
  ): Promise<FastifyReply> {
    const obj = await statObjectOrNull(config.zarizeniBucket, klic);
    if (!obj) return reply.status(404).send({ error: 'not_uploaded' });
    const r = prectiRozsah(req.headers.range, obj.size);
    if (r.druh === 'mimo') {
      return reply
        .status(416)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Range', `bytes */${obj.size}`)
        .send({ error: 'range_not_satisfiable', velikost: obj.size });
    }
    if (r.druh === 'cast') {
      const proud = await getObjectRange(config.zarizeniBucket, klic, r.od, r.delka);
      return reply
        .status(206)
        .header('Content-Type', APK_TYP)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Range', `bytes ${r.od}-${r.do}/${obj.size}`)
        .header('Content-Length', String(r.delka))
        .header('Cache-Control', 'no-store')
        .send(proud);
    }
    const proud = await getObjectStream(config.zarizeniBucket, klic);
    return reply
      .header('Content-Type', APK_TYP)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', String(obj.size))
      .header('Cache-Control', 'no-store')
      .send(proud);
  }


  /**
   * Žádost o nastavení = co administrace vložila do QR. Slouží jako vzor pro
   * další tablet a jako stopa, podle které se dá dohledat, s čím se který
   * tablet nastavoval. Heslo k Wi-Fi tělo NESMÍ nést (viz lib/zadosti.ts).
   */
  app.post('/zarizeni/zadosti', async (req, reply) => {
    const user = await adminUzivatel(req, reply);
    if (!user) return reply;
    const stav = await stavZarizeni();
    if (!stav.zapnuto) return reply.status(404).send({ error: 'not_configured' });
    let vstup;
    try {
      vstup = prectiVstup(req.body);
    } catch (err) {
      if (err instanceof VadnaZadost) return reply.status(400).send({ error: 'invalid_request', detail: err.message });
      throw err;
    }
    const zadost = novaZadost(vstup, user.email ?? user.userId, {
      versionCode: stav.hlidac.versionCode,
      checksum: checksumQr(stav.hlidac.certSha256),
    });
    const data = Buffer.from(JSON.stringify(zadost), 'utf8');
    await zajistiBucket(config.zarizeniBucket);
    await putObjectStream(config.zarizeniBucket, klicZadosti(zadost.vytvoreno, zadost.id), Readable.from([data]), data.length, {
      'Content-Type': 'application/json',
    });
    return reply.status(201).send(zadost);
  });

  app.get('/zarizeni/zadosti', async (req, reply) => {
    if (!(await admin(req, reply))) return reply;
    const klice = nejnovejsi(await vypisKlice(config.zarizeniBucket, PREFIX_ZADOSTI));
    const zadosti = (await Promise.all(klice.map((k) => prectiJson(k)))) as ZadostHlidace[];
    return reply.header('Cache-Control', 'no-store').send({ zadosti });
  });

  app.get('/zarizeni/konfigurace', async (req, reply) => {
    if (!(await admin(req, reply))) return reply;
    const stav = await stavZarizeni();
    if (!stav.zapnuto) return reply.send(stav);
    const h = stav.hlidac;
    const apk = await statObjectOrNull(config.zarizeniBucket, klicApk(h));
    return reply.send({
      zapnuto: true,
      hlidac: { ...h, checksum: checksumQr(h.certSha256), spravce: `${h.applicationId}/platforma.hlidac.SpravceReceiver` },
        // Výbava jde do administrace, protože QR se vyrábí TAM (i ve skriptu pro technika).
      // Bez veřejné adresy storage nemá tablet odkud stahovat — administrace to řekne.
      stazeni: config.storagePublicUrl ? `${config.storagePublicUrl}/zarizeni/hlidac.apk` : null,
      apk: apk && {
        bajtu: apk.size,
        nahrano: apk.lastModified.toISOString(),
        sha256: apk.metaData['x-amz-meta-sha256'] ?? apk.metaData.sha256 ?? null,
      },
      // Deklarované appky + jejich stav v úložišti. Administrace musí vidět
      // ROZDÍL: „deklarováno, ale nenahráno" a „nahráno něco jiného" jsou dvě
      // různé poruchy a člověk je řeší jinak.
      appky: await Promise.all(
        (h.appky ?? []).map(async (a) => {
          const obj = await statObjectOrNull(config.zarizeniBucket, klicAppky(a.balicek));
          const vUlozisti = obj ? (obj.metaData['x-amz-meta-sha256'] ?? obj.metaData.sha256 ?? null) : null;
          return {
            ...a,
            nahrano: obj ? obj.lastModified.toISOString() : null,
            bajtuVUlozisti: obj ? obj.size : null,
            stav: !obj
              ? ('chybi' as const)
              : typeof vUlozisti === 'string' && vUlozisti.toLowerCase() === a.sha256.toLowerCase()
                ? ('drzi' as const)
                : ('nesedi' as const),
          };
        }),
      ),
    });
  });

  app.put('/zarizeni/hlidac', async (req, reply) => {
    if (!(await admin(req, reply))) {
      zahodZbytek(req.raw);
      return reply;
    }
    const stav = await stavZarizeni();
    const odmitni = (kod: number, telo: Record<string, unknown>) => {
      zahodZbytek(req.raw);
      return reply.status(kod).send(telo);
    };
    if (!stav.zapnuto) return odmitni(404, { error: 'not_configured', detail: stav.chyba ?? null });
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== APK_TYP) {
      return odmitni(415, { error: 'unsupported_type', expected: APK_TYP });
    }
    const delka = Number(req.headers['content-length']);
    if (!Number.isInteger(delka) || delka <= 0) return odmitni(411, { error: 'length_required' });
    if (delka > config.maxApkMb * 1024 * 1024) return odmitni(413, { error: 'file_too_large' });

    // APK se nejdřív CELÉ načte (≤ 20 MB, hlídač má desítky kB) a ověří —
    // ZIP, délka, SHA-256 ze skutečného obsahu. Do úložiště jde až ověřené:
    // přerušené nebo cizí nahrání tak nepřepíše funkčního hlídače, ze kterého
    // se nastavují tablety.
    const hlidac = new HlidanyProud(delka, { sha256: true, zacatek: ZIP });
    const sber: Buffer[] = [];
    try {
      await new Promise<void>((hotovo, chyba) => {
        hlidac.on('data', (c: Buffer) => sber.push(c));
        hlidac.on('end', hotovo);
        hlidac.on('error', chyba);
        vedTelo(req.raw, hlidac);
      });
    } catch (err) {
      zahodZbytek(req.raw, hlidac);
      if (err instanceof PrilisVelke) return reply.status(413).send({ error: 'file_too_large' });
      if (err instanceof SpatnyZacatek) return reply.status(415).send({ error: 'not_an_apk' });
      throw err;
    }
    const obsah = Buffer.concat(sber);
    const sha256 = hlidac.sha256() ?? '';
    // ⛔ DEKLARACE JE ZÁVAZNÁ I PRO NAHRÁNÍ. Bez tohohle by „deklarace konverguje"
    //    byla prázdná věta: správce by nahrál jinou binárku, služba by ji přijala
    //    a teprve tablet by ji odmítl — jinde a později.
    // ⛔ BEZ DEKLAROVANÉHO OTISKU SE NENAHRÁVÁ (revize aisha-team 2026-09-24):
    //    `if (ocekavany && …)` tu pouštělo JAKÝKOLI soubor, když deklarace
    //    `apk.sha256` neměla — na rozdíl od sousední trasy pro appky. Tablet by ho
    //    sice nedostal (seznam nabízí jen shodný otisk), ale úložiště by drželo
    //    něco, co nikdo nedeklaroval.
    const ocekavany = stav.hlidac.apkSha256;
    if (!ocekavany) return reply.status(409).send({ error: 'sha256_not_declared' });
    if (ocekavany.toLowerCase() !== sha256.toLowerCase()) {
      return reply.status(409).send({ error: 'sha256_mismatch', deklarovano: ocekavany.toLowerCase(), nahrano: sha256 });
    }
    const zdroj = new PassThrough();
    zdroj.end(obsah);
    try {
      await zajistiBucket(config.zarizeniBucket);
      await putObjectStream(config.zarizeniBucket, klicApk(stav.hlidac), zdroj, obsah.length, {
        'Content-Type': APK_TYP,
        sha256,
      });
    } catch (err) {
      req.log.error({ err }, 'Upload of guard APK to storage failed');
      return reply.status(502).send({ error: 'storage_failed' });
    }
    return reply.send({ ok: true, bajtu: obsah.length, sha256 });
  });

  /**
   * Nahrání balíčku DEKLAROVANÉ appky (administrace).
   *
   * ⭐ ZADÁNÍ MAJITELE 2026-09-22: „je to artefakt co se má smazat a nahrát to do
   * minia… nezůstane apk v repo." Binárka tedy nebydlí v datech instance ani
   * v obrazu — přichází sem a odtud do úložiště.
   *
   * ⛔ PROUDEM DO SOUBORU, NE DO PAMĚTI. Hlídač má desítky kB, appka řidiče 86 MB;
   *    ta se do haldy načítat nemá. Ověřit se přesto musí PŘED uložením, jinak by
   *    přerušené nahrání přepsalo funkční balíček, ze kterého se staví tablety.
   *
   * ⛔ NAHRÁT LZE JEN DEKLAROVANOU appku a JEN se shodným otiskem. Jméno z adresy
   *    se nikdy nestane klíčem do bucketu a neshoda otisku je 409, ne varování.
   */
  app.put('/zarizeni/appky/:balicek', async (req, reply) => {
    if (!(await admin(req, reply))) {
      zahodZbytek(req.raw);
      return reply;
    }
    const stav = await stavZarizeni();
    const odmitni = (kod: number, telo: Record<string, unknown>) => {
      zahodZbytek(req.raw);
      return reply.status(kod).send(telo);
    };
    if (!stav.zapnuto) return odmitni(404, { error: 'not_configured', detail: stav.chyba ?? null });
    const { balicek } = req.params as { balicek: string };
    const deklarovana = (stav.hlidac.appky ?? []).find((a) => a.balicek === balicek);
    if (!deklarovana) return odmitni(404, { error: 'not_declared' });
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== APK_TYP) {
      return odmitni(415, { error: 'unsupported_type', expected: APK_TYP });
    }
    const delka = Number(req.headers['content-length']);
    if (!Number.isInteger(delka) || delka <= 0) return odmitni(411, { error: 'length_required' });
    if (delka > config.maxApkMb * 1024 * 1024) return odmitni(413, { error: 'file_too_large', maxMb: config.maxApkMb });

    const adresar = await mkdtemp(join(tmpdir(), 'zarizeni-'));
    const docasny = join(adresar, 'balicek.apk');
    const hlidac = new HlidanyProud(delka, { sha256: true, zacatek: ZIP });
    try {
      await new Promise<void>((hotovo, chyba) => {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- cesta je per-call tmpdir (mkdtemp) + literál `balicek.apk`; z požadavku do ní nevede NIC, jméno balíčku se používá jen jako klíč v bucketu a jen po ověření proti deklaraci
        const ven = createWriteStream(docasny);
        hlidac.on('error', chyba);
        ven.on('error', chyba);
        ven.on('finish', hotovo);
        hlidac.pipe(ven);
        vedTelo(req.raw, hlidac);
      });
      const sha256 = hlidac.sha256() ?? '';
      if (sha256.toLowerCase() !== deklarovana.sha256.toLowerCase()) {
        return reply.status(409).send({ error: 'sha256_mismatch', deklarovano: deklarovana.sha256, nahrano: sha256 });
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- cesta je per-call tmpdir (mkdtemp) + literál `balicek.apk`; z požadavku do ní nevede NIC, jméno balíčku se používá jen jako klíč v bucketu a jen po ověření proti deklaraci
      const bajtu = (await stat(docasny)).size;
      await zajistiBucket(config.zarizeniBucket);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- cesta je per-call tmpdir (mkdtemp) + literál `balicek.apk`; z požadavku do ní nevede NIC, jméno balíčku se používá jen jako klíč v bucketu a jen po ověření proti deklaraci
      await putObjectStream(config.zarizeniBucket, klicAppky(balicek), createReadStream(docasny), bajtu, {
        'Content-Type': APK_TYP,
        sha256,
      });
      return reply.send({ ok: true, balicek, bajtu, sha256, versionCode: deklarovana.versionCode });
    } catch (err) {
      zahodZbytek(req.raw, hlidac);
      if (err instanceof PrilisVelke) return reply.status(413).send({ error: 'file_too_large', maxMb: config.maxApkMb });
      if (err instanceof SpatnyZacatek) return reply.status(415).send({ error: 'not_an_apk' });
      req.log.error({ err, balicek }, 'nahrání balíčku appky do úložiště selhalo');
      return reply.status(502).send({ error: 'storage_failed' });
    } finally {
      // Dočasný soubor nesmí přežít ani úspěch, ani pád — 86 MB na disku služby.
      await rm(adresar, { recursive: true, force: true }).catch(() => {});
    }
  });

  /**
   * Co má být na tabletu nainstalované. Hlídač se ptá v nočním okně a porovná
   * `versionCode` s tím, co na zařízení skutečně je.
   *
   * ⛔ BEZ PŘIHLÁŠENÍ, stejně jako `hlidac.apk` — hlídač je systémová součást
   * tabletu, žádného člověka nezná a token nemá. Trasa leží ZA DVEŘMI (API);
   * kdo je otevřít neumí, seznam neuvidí.
   *
   * ⚠️ Seznam je jen SEZNAM: nic se z něj nestane nainstalovaným. Pravost
   * balíčku stojí na otisku z DEKLARACE a na tom, že Android odmítne
   * aktualizaci podepsanou jiným klíčem.
   */
  app.get('/zarizeni/appky', async (_req, reply) => {
    const stav = await stavZarizeni();
    if (!stav.zapnuto) return reply.status(404).send({ error: 'not_configured' });
    const appky = stav.hlidac.appky ?? [];
    const zaklad = config.storagePublicUrl;
    const vysledek = [];
    for (const a of appky) {
      // Co NENÍ v úložišti, to se NENABÍZÍ: hlídač by si jinak sáhl na 404 a
      // hlásil chybu stahování tam, kde je vada distribuce.
      const obj = await statObjectOrNull(config.zarizeniBucket, klicAppky(a.balicek));
      if (!obj) continue;
      // ⛔ A CO V ÚLOŽIŠTI NESEDÍ OTISKEM, TO TAKY NE — stejné pravidlo, jaké
      //    Kiosk Admin sám sobě uplatňuje níž. NAMĚŘENO 2026-09-24: deklarace
      //    slibovala 1.1.0 (14), v bucketu ležel soubor verze 12. Seznam ho
      //    nabídl, kiosk v nočním okně stáhl 52 MB, otisk nesedl a balíček
      //    zahodil — a zítra znovu. Nesoulad je vada distribuce; řeší ji
      //    doplnění ze zdroje (lib/doplneni-baliku.ts), ne tablet.
      const vUlozisti = obj.metaData['x-amz-meta-sha256'] ?? obj.metaData.sha256;
      if (typeof vUlozisti !== 'string' || vUlozisti.toLowerCase() !== a.sha256.toLowerCase()) continue;
      vysledek.push({
        balicek: a.balicek,
        versionCode: a.versionCode,
        versionName: a.versionName,
        sha256: a.sha256,
        bajtu: obj.size,
        url: zaklad ? `${zaklad}/zarizeni/appky/${a.balicek}.apk` : null,
      });
    }
    // ⭐ HLÍDAČ SE NABÍZÍ SÁM SOBĚ — jako POSLEDNÍ položka. Bez toho se hlídač
    //    na tabletu nedal aktualizovat jinak než továrním resetem (2026-09-22:
    //    každá oprava hlídače = každý tablet znovu zavést). Posledně proto, že
    //    instalace sebe sama ukončí jeho proces — appky musí být hotové předtím.
    // ⛔ Jen když úložiště drží PŘESNĚ deklarovaný soubor: jinak by si ho tablet
    //    při každé kontrole stáhl a hlásil nesoulad otisku tam, kde je vada
    //    distribuce (nenahráno), ne tabletu.
    const h = stav.hlidac;
    const objHlidace = await statObjectOrNull(config.zarizeniBucket, klicApk(h));
    const vUlozisti = objHlidace ? (objHlidace.metaData['x-amz-meta-sha256'] ?? objHlidace.metaData.sha256 ?? null) : null;
    if (
      objHlidace && zaklad && h.apkSha256 &&
      typeof vUlozisti === 'string' && vUlozisti.toLowerCase() === h.apkSha256.toLowerCase()
    ) {
      vysledek.push({
        balicek: h.applicationId,
        versionCode: h.versionCode,
        versionName: h.versionName,
        sha256: h.apkSha256.toLowerCase(),
        bajtu: objHlidace.size,
        url: `${zaklad}/zarizeni/hlidac.apk`,
      });
    }
    return reply.header('Cache-Control', 'no-store').send({ appky: vysledek, deklarovano: appky.length });
  });

  // ⛔ STAHOVÁNÍ BALÍČKŮ MÁ VLASTNÍ LIMIT (2026-09-28). Tablety jedou po LTE a
  //    sdílejí adresu operátora; globální 100/min jim uprostřed stahování
  //    odpovídal 429 a Kiosk Admin to po třech kusech vzdal. Úroveň
  //    `device-download` (packages/security) i s měřením.
  app.get('/zarizeni/appky/:balicek.apk', { config: routeRateLimit('device-download') }, async (req, reply) => {
    const stav = await stavZarizeni();
    if (!stav.zapnuto) return reply.status(404).send({ error: 'not_configured' });
    const { balicek } = req.params as { balicek: string };
    // ⛔ Stahuje se JEN to, co instance DEKLAROVALA. Jméno z adresy se nikdy
    //    nestane klíčem do bucketu — jinak by trasa vydala cokoli, co tam leží.
    const deklarovana = (stav.hlidac.appky ?? []).find((a) => a.balicek === balicek);
    if (!deklarovana) return reply.status(404).send({ error: 'not_declared' });
    return vydejBalicek(req, reply, klicAppky(deklarovana.balicek));
  });

  app.get('/zarizeni/hlidac.apk', { config: routeRateLimit('device-download') }, async (req, reply) => {
    const stav = await stavZarizeni();
    if (!stav.zapnuto) return reply.status(404).send({ error: 'not_configured' });
    return vydejBalicek(req, reply, klicApk(stav.hlidac));
  });

  /**
   * Hlášení tabletu (lib/hlaseni.ts): co na něm Kiosk Admin opravdu má a jak
   * dopadlo poslední rozdávání.
   *
   * ⛔ BEZ PŘIHLÁŠENÍ, stejně jako seznam appek — Kiosk Admin token nemá. Trasa
   *    leží ZA DVEŘMI; přehled je informace pro správce, ne identita (tu nese F1).
   * ⛔ JEDEN OBJEKT NA ZAŘÍZENÍ, přepisuje se. Nové zařízení nad stropem
   *    MAX_ZARIZENI se odmítne — bez přihlášení by se jinak dalo úložiště zaplavit.
   */
  app.post(
    '/zarizeni/hlaseni',
    { config: routeRateLimit('mutation'), bodyLimit: MAX_TELO_BAJTU },
    async (req, reply) => {
      const stav = await stavZarizeni();
      if (!stav.zapnuto) return reply.status(404).send({ error: 'not_configured' });
      let h;
      try {
        h = prectiHlaseni(req.body);
      } catch (err) {
        if (err instanceof VadneHlaseni) return reply.status(400).send({ error: 'invalid_report', detail: err.message });
        throw err;
      }
      const klic = klicHlaseni(h.zarizeni);
      let predchozi: UlozeneHlaseni | null = null;
      if (await statObjectOrNull(config.zarizeniBucket, klic)) {
        predchozi = (await prectiJson(klic)) as UlozeneHlaseni;
      } else if ((await vypisKlice(config.zarizeniBucket, PREFIX_HLASENI)).length >= MAX_ZARIZENI) {
        return reply.status(409).send({ error: 'device_limit' });
      }
      const data = Buffer.from(JSON.stringify(ulozitelne(h, predchozi, new Date())), 'utf8');
      await zajistiBucket(config.zarizeniBucket);
      await putObjectStream(config.zarizeniBucket, klic, Readable.from([data]), data.length, {
        'Content-Type': 'application/json',
      });
      return reply.status(204).send();
    },
  );

  /**
   * Přehled zařízení pro administraci: hlášení všech tabletů + CO SE MÁ na
   * tabletu nacházet (deklarace instance), aby šlo říct „aktuální / starší / chybí".
   */
  app.get('/zarizeni/hlaseni', async (req, reply) => {
    if (!(await admin(req, reply))) return reply;
    const stav = await stavZarizeni();
    if (!stav.zapnuto) return reply.status(404).send({ error: 'not_configured' });
    const klice = (await vypisKlice(config.zarizeniBucket, PREFIX_HLASENI)).filter((k) => k.endsWith('.json'));
    const hlaseni = (await Promise.all(klice.map((k) => prectiJson(k)))) as UlozeneHlaseni[];
    hlaseni.sort((a, b) => b.prijato.localeCompare(a.prijato));
    const h = stav.hlidac;
    return reply.header('Cache-Control', 'no-store').send({
      zarizeni: hlaseni,
      appky: (h.appky ?? []).map((a) => ({ balicek: a.balicek, versionCode: a.versionCode, versionName: a.versionName })),
      kioskAdmin: { balicek: h.applicationId, versionCode: h.versionCode, versionName: h.versionName },
    });
  });
};
