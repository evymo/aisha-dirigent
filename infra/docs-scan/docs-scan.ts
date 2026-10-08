/**
 * docs-scan — antivirová brána mezi synchronizací dokumentů a vstupem ingestu.
 *
 * ⛔ NAMĚŘENO 2026-10-03: `docs-sync` (rclone) stahoval dokumenty z externího úložiště
 * rovnou do svazku, který engine čte. Antivirem procházely jen nahrávky přes
 * storage-auth; dokument uložený do úložiště se k uživatelům dostal bez kontroly
 * (extranet ho nabízí ke stažení) a engine ho parsoval.
 *
 * TVAR
 *   docs-sync  →  /karantena  →  [docs-scan: clamd INSTREAM]  →  /docs  →  engine (:ro)
 *
 *   · `docs-sync` píše JEN do karantény (`--compare-dest /docs` — co už ve vstupu je
 *     beze změny, znovu nestahuje).
 *   · Tenhle proces soubor pošle clamd a do `/docs` ho přesune AŽ po verdiktu `clean`
 *     (dočasné jméno začínající tečkou + rename: engine tečkové soubory nečte, takže
 *     rozepsaný soubor nikdy nevidí).
 *   · Nález zůstává v karanténě a pamatuje se; nová verze v úložišti ho přepíše a sken
 *     proběhne znovu. I beze změny se zadržený soubor zkouší znovu S ODSTUPEM (viz níž).
 *   · Co už ve vstupu leží z doby před touhle branou, se doskenuje na místě; nález
 *     se ze vstupu STÁHNE do karantény. Do té doby engine tyhle soubory čte dál —
 *     už je jednou přečetl; vyprázdnit vstup by četl jako „dokumenty zmizely". Kolik
 *     jich na posouzení čeká, říká každé kolo (`neovereno`).
 *
 * FAIL-CLOSED, ALE NE SLEPĚ — kdo je vadný: soubor, nebo platforma?
 *   (nálezy nezávislého čtení 2026-10-03: přechodná chyba skenu byla trvalé zadržení
 *   a jedna chyba u jednoho souboru zastavila frontu za ním, obojí potichu)
 *   · Verdikt jiný než `clean` = soubor do vstupu nevstoupí. Nikdy „pusť to, když
 *     antivir neodpovídá".
 *   · VADA SOUBORU: nález; clamd odpověděl „nad limit velikosti"; soubor nejde otevřít
 *     nebo číst; na jeho místě ve vstupu stojí složka. Soubor se zadrží s důvodem
 *     a zkusí se znovu s odstupem (nález a „nad limit" za den — signatury i limit se
 *     mění; ostatní za 15 min, pak dvojnásobek, nejvýš den). Fronta jede dál.
 *   · NEJASNÉ (vypršený čas skenu, zavřené spojení, jiná chyba clamd) rozhodne
 *     KONTROLNÍ VZOREK: brána hned pošle clamd pár bajtů, o kterých ví, že jsou čisté.
 *     Vrátí-li se „čistý", clamd skenuje a vada je v souboru (zadržet, odstup). Nevrátí-li
 *     se, je to stav platformy — vytížený antivir není „vada všech souborů".
 *   · STAV PLATFORMY: clamd neodpovídá na PING nebo neposoudí ani kontrolní vzorek; do
 *     vstupu nejde zapsat (plný disk, svazek jen pro čtení, práva). Nic se nezadržuje,
 *     kolo končí překážkou a další to zkusí znovu.
 *   · TEP (soubor `tep`) se zapíše jen v kole bez překážky. Healthcheck kontejneru čte
 *     jeho stáří: nečinná instance bez dokumentů je zdravá i bez antiviru; instance,
 *     které dokumenty čekají a brána je nemá jak posoudit nebo propustit, je nezdravá.
 *   · STAV A TEP leží ve VLASTNÍM adresáři (`DOCS_SCAN_STATE`, svazek připojený jen
 *     sem) — synchronizace do něj nedosáhne, takže zdraví ani přehled ověřených
 *     nejde přepsat souborem z úložiště.
 *
 * Klient clamd je sdílený (`packages/security/src/av-scan.ts`) — týž soubor, který
 * běží ve storage-auth a u nahrání do znalostní báze. Spouští se přímo ze zdroje
 * (Node umí TypeScript bez sestavení, pokud je jen „odmazatelný"), proto tu ani
 * v klientovi nesmí být enum, namespace ani parametrické vlastnosti konstruktoru.
 *
 * Konfigurace JEN z prostředí, bez výchozích hodnot v kódu (dodává compose):
 *   CLAMD_HOST                  cíl skenu (doručuje platforma z identity instance)
 *   CLAMD_PORT                  port stacku antiviru (v compose literál — kontrakt stacku, ne instance)
 *   DOCS_SCAN_INTERVAL          pauza mezi koly, s (v compose literál)
 *   DOCS_SCAN_QUARANTINE        karanténa (zapisuje docs-sync)
 *   DOCS_SCAN_TARGET            vstup enginu
 *   DOCS_SCAN_STATE             stav a tep brány (jen tahle služba)
 */
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { ping, scan, scanBuffer } from '../../packages/security/src/av-scan.ts';
import type { AvScanTarget, AvVerdict } from '../../packages/security/src/av-scan.ts';

/** Strop jednoho skenu. Týž jako interní sken storage-auth: clamd u velkých archivů počítá dlouho. */
const SCAN_TIMEOUT_MS = 120_000;
const PING_TIMEOUT_MS = 5_000;
/** Kontrolní vzorek: obsah, o kterém brána VÍ, že je čistý — a čas, do kdy ho clamd musí posoudit. */
const VZOREK = Buffer.from('docs-scan: kontrolní vzorek');
const VZOREK_TIMEOUT_MS = 10_000;
/** Blok čtení otevřeného souboru (sken i přenos); klient clamd si ho rámcuje sám. */
const BLOK = 64 * 1024;
/** Přípona dočasného souboru při přenosu; jméno začíná tečkou, takže ho engine nečte. */
const TMP_PRIPONA = '.docs-scan-tmp';
/** Kam se stáhne soubor ze vstupu, když jeho místo v karanténě drží zadržený jmenovec. */
const STAZENO_DIR = 'stazeno';

const MINUTA = 60_000;
const DEN = 24 * 60 * MINUTA;
/** Odstup dalšího pokusu u zadrženého souboru (ms). */
export function odstup(druh: Zadrzeny['druh'], pokusu: number): number {
  // Nález a „nad limit": výsledek se změní až se signaturami nebo s nastavením clamd.
  if (druh === 'nalez' || druh === 'nad_limit') return DEN;
  return Math.min(15 * MINUTA * 2 ** Math.max(0, pokusu - 1), DEN);
}

export interface Otisk {
  size: number;
  mtimeMs: number;
}
export interface Zadrzeny extends Otisk {
  verdikt: 'infected' | 'rejected';
  /** Proč: nález · clamd řekl „nad limit" · jiná vada souboru. */
  druh: 'nalez' | 'nad_limit' | 'soubor';
  duvod: string;
  /** Kdy byl zadržen poprvé (s tímhle otiskem). */
  kdy: string;
  pokusu: number;
  /** Nejdřív kdy se zkusí znovu (ISO). */
  dalsi: string;
}
export interface Stav {
  /** Soubory ve vstupu enginu, které prošly skenem (rel. cesta → otisk v době skenu). */
  overeno: Record<string, Otisk>;
  /** Soubory držené v karanténě (rel. cesta → proč). */
  zadrzeno: Record<string, Zadrzeny>;
  /** Soubory stažené ze vstupu mimo karanténu, protože jejich místo drží zadržený jmenovec. */
  stazeno: Record<string, { duvod: string; kdy: string }>;
}
export interface Kolo {
  /** clamd odpověděl na PING na začátku kola. */
  clamd: boolean;
  /** Soubory přesunuté do vstupu / ověřené na místě v tomhle kole. */
  propusteno: number;
  /** Soubory v tomhle kole zadržené (nově nebo znovu po dalším pokusu). */
  zadrzeno: number;
  /** Soubory, které zůstaly ve frontě (clamd nedostupný, překážka, změna během přenosu). */
  ceka: number;
  /** Kolo nenechalo práci stát kvůli platformě → smí zapsat tep. */
  bezPrekazky: boolean;
  /** Proč kolo práci nechalo stát (když `bezPrekazky` neplatí). */
  prekazka?: string;
  /** Všechno, co brána po kole drží: počty podle důvodu a nejstarší zadržení. */
  drzeno: { nalezy: number; neposouditelne: number; nejstarsi: string | null };
  /** Co není dokument: tečková jména, rozepsaná stažení, symbolické odkazy (obě strany dohromady). */
  preskoceno: { teckove: number; rozepsane: number; odkazy: number };
  /** Soubory ve vstupu, které engine čte a brána je ještě neposoudila. */
  neovereno: number;
}
export interface Nastaveni {
  karantena: string;
  cil: string;
  /** Adresář stavu a tepu — mimo karanténu i vstup. */
  stav: string;
  clamd: AvScanTarget;
  log?: (zprava: string) => void;
  /** Hodiny (ms) — kvůli odstupům; výchozí `Date.now`. */
  ted?: () => number;
}

const prazdnyStav = (): Stav => ({ overeno: {}, zadrzeno: {}, stazeno: {} });

async function nactiStav(dir: string): Promise<Stav> {
  try {
    const s = JSON.parse(await readFile(path.join(dir, 'stav.json'), 'utf8')) as Partial<Stav>;
    return { overeno: s.overeno ?? {}, zadrzeno: s.zadrzeno ?? {}, stazeno: s.stazeno ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return prazdnyStav();
    // Nečitelný stav NENÍ „žádný stav": tiché vynulování by zapomnělo zadržené nálezy
    // a co je horší — i to, co je ověřené. Radši stát, než hádat.
    throw new Error(`docs-scan: stav brány nejde přečíst (${(err as Error).message}) — nepokračuji`);
  }
}

async function zapisAtomicky(soubor: string, obsah: string): Promise<void> {
  const tmp = `${soubor}.tmp`;
  await writeFile(tmp, obsah, 'utf8');
  await rename(tmp, soubor);
}

async function ulozStav(dir: string, stav: Stav): Promise<void> {
  await mkdir(dir, { recursive: true });
  await zapisAtomicky(path.join(dir, 'stav.json'), JSON.stringify(stav));
}

interface Vypis {
  /** Relativní cesty dokumentů, seřazené. */
  soubory: string[];
  teckove: number;
  rozepsane: number;
  /** Relativní cesty symbolických odkazů. */
  odkazy: string[];
}

/**
 * Co pod kořenem leží. DOKUMENT je totéž, co za vstup považuje engine: běžný soubor,
 * jehož JMÉNO nezačíná tečkou — ve kterékoli složce, i tečkové (engine prochází strom
 * celý a hledí jen na jméno souboru). Co dokument není, se POČÍTÁ, ne mlčky vynechá.
 */
async function vypis(koren: string): Promise<Vypis> {
  const v: Vypis = { soubory: [], teckove: 0, rozepsane: 0, odkazy: [] };
  const jdi = async (dir: string): Promise<void> => {
    let polozky;
    try {
      polozky = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const p of polozky) {
      const plna = path.join(dir, p.name);
      if (p.isSymbolicLink()) v.odkazy.push(path.relative(koren, plna));
      else if (p.isDirectory()) await jdi(plna);
      else if (!p.isFile()) continue;
      else if (p.name.endsWith('.partial')) v.rozepsane += 1;
      else if (p.name.startsWith('.')) v.teckove += 1;
      else v.soubory.push(path.relative(koren, plna));
    }
  };
  await jdi(koren);
  v.soubory.sort();
  return v;
}

const otiskZ = (s: { size: number; mtimeMs: number }): Otisk =>
  // Dolů na ms: přenos zachovává čas s přesností Date (ms), jinak by se otisk po přenosu lišil.
  ({ size: s.size, mtimeMs: Math.floor(s.mtimeMs) });
const otisk = async (soubor: string): Promise<Otisk> => otiskZ(await stat(soubor));
const stejny = (a: Otisk | undefined, b: Otisk): boolean => !!a && a.size === b.size && a.mtimeMs === b.mtimeMs;

/**
 * Obsah OTEVŘENÉHO souboru od začátku, po blocích, pozičním čtením. Jediný způsob, jak
 * brána čte soubor, který drží — pro sken i pro přenos.
 *
 * ⛔ NE `fh.createReadStream()` (nález revize 2026-10-05, naměřeno testem): klient clamd
 * přestane číst, jakmile clamd odpoví dřív, než dostal celý soubor (nad limit, chyba) —
 * a předčasně ukončený proud se ZNIČÍ. Proud nad FileHandle tím zavře i ten handle, ať je
 * `autoClose` jakékoli. Stažení zadrženého souboru ze vstupu pak skončilo EBADF, četlo se
 * jako stav platformy a kolo stálo na tomtéž souboru v každém kole (tep se nezapsal).
 * Generátor deskriptor nevlastní: kdo ho přestane číst, jen přestane číst; soubor zavře
 * jediné místo — `finally` v kole.
 */
async function* obsahZ(fh: FileHandle): AsyncGenerator<Buffer> {
  for (let pozice = 0; ; ) {
    // Nový blok pro každé čtení: zapisovací proud přenosu si předaný blok drží až do zápisu.
    const blok = Buffer.allocUnsafe(BLOK);
    const { bytesRead } = await fh.read(blok, 0, BLOK, pozice);
    if (bytesRead === 0) return;
    pozice += bytesRead;
    yield blok.subarray(0, bytesRead);
  }
}

/** Dočasné jméno přenosu vedle cíle — začíná tečkou, aby ho engine nikdy nečetl rozepsané. */
export const docasneJmeno = (cil: string): string =>
  path.join(path.dirname(cil), `.${path.basename(cil)}${TMP_PRIPONA}`);

/** Zápis na cílové místo selhal — `kdo` říká, čí je to vada. */
class ChybaZapisu extends Error {
  kdo: 'soubor' | 'platforma';
  constructor(kdo: 'soubor' | 'platforma', zprava: string) {
    super(zprava);
    this.kdo = kdo;
  }
}
/**
 * Chyby zápisu, které patří KONKRÉTNÍ cestě (na místě souboru stojí složka, jméno je
 * moc dlouhé). Všechno ostatní — plný disk, svazek jen pro čtení, práva, chyba zařízení
 * i kód, který neznáme — je stav platformy: zadržet kvůli němu soubor po souboru by
 * frontu potichu odložilo o hodiny.
 */
const VADA_CESTY = new Set(['ENOTDIR', 'EISDIR', 'EEXIST', 'ENAMETOOLONG', 'ELOOP', 'ENOTEMPTY']);

/**
 * Zapíše obsah OTEVŘENÉHO souboru na cílové místo tak, aby čtenář nikdy neviděl rozepsaný
 * obsah; čas zachová. Vrací `false`, když se soubor během práce ZMĚNIL — pak se nezapsalo nic.
 *
 * ⛔ Z DESKRIPTORU, NE Z CESTY. Sken i přenos čtou tentýž otevřený soubor: synchronizace
 * mezitím smí na téže cestě vyměnit soubor za novější verzi (stahuje do dočasného jména
 * a přejmenuje) — kdyby se kopírovalo podle cesty, do vstupu by vstoupila verze, kterou
 * clamd nikdy neviděl.
 *
 * ⛔ A PO KOPII SE POROVNÁ OTISK s tím před skenem (`videno`): deskriptor chrání před
 * výměnou souboru, ne před přepisem NA MÍSTĚ. Že synchronizace na místě nepřepisuje, je
 * vlastnost jiného kontejneru a jeho verze, ne téhle brány.
 */
async function zapisZ(fh: FileHandle, cil: string, mode: number, videno: Otisk): Promise<boolean> {
  const tmp = docasneJmeno(cil);
  try {
    const s = await fh.stat();
    await mkdir(path.dirname(cil), { recursive: true });
    await pipeline(obsahZ(fh), createWriteStream(tmp, { mode }));
    if (!stejny(videno, otiskZ(await fh.stat()))) {
      await rm(tmp, { force: true });
      return false;
    }
    await chmod(tmp, mode);
    // Čas souboru je součást dohody se synchronizací (porovnává velikost + čas) i s enginem
    // (hlídač vstupu): bez něj by se týž soubor stahoval a zpracovával dokola.
    await utimes(tmp, s.atime, s.mtime);
    await rename(tmp, cil);
    return true;
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    const kod = (err as NodeJS.ErrnoException).code ?? '';
    throw new ChybaZapisu(VADA_CESTY.has(kod) ? 'soubor' : 'platforma', `${kod || 'chyba'}: ${(err as Error).message}`);
  }
}

/** Smaže cestu jen tehdy, když na ní pořád leží TÝŽ soubor, který držíme otevřený. */
async function smazPokudTyz(cesta: string, fh: FileHandle): Promise<void> {
  const [nyni, nas] = await Promise.all([stat(cesta).catch(() => null), fh.stat()]);
  if (!nyni || nyni.ino !== nas.ino || nyni.dev !== nas.dev) return;
  try {
    await rm(cesta);
  } catch (err) {
    // Zdroj nejde uklidit (svazek jen pro čtení, práva): stav platformy, ne vada souboru.
    throw new ChybaZapisu('platforma', `úklid „${cesta}" selhal: ${(err as Error).message}`);
  }
}

/** Jedno kolo. Vrací, co se stalo; NIKDY nepropustí soubor bez verdiktu `clean`. */
export async function kolo(n: Nastaveni): Promise<Kolo> {
  const log = n.log ?? (() => undefined);
  const ted = (n.ted ?? Date.now)();
  const stav = await nactiStav(n.stav);
  const vysledek: Kolo = {
    clamd: false,
    propusteno: 0,
    zadrzeno: 0,
    ceka: 0,
    bezPrekazky: true,
    drzeno: { nalezy: 0, neposouditelne: 0, nejstarsi: null },
    preskoceno: { teckove: 0, rozepsane: 0, odkazy: 0 },
    neovereno: 0,
  };
  let zmena = false;

  const karantena = await vypis(n.karantena);
  const vstup = await vypis(n.cil);
  vysledek.preskoceno = {
    teckove: karantena.teckove + vstup.teckove,
    rozepsane: karantena.rozepsane + vstup.rozepsane,
    odkazy: karantena.odkazy.length + vstup.odkazy.length,
  };
  // Odkaz ve vstupu engine NÁSLEDUJE a brána ho posoudit neumí (cíl může ležet kdekoli).
  // Sama odkazy nezakládá a synchronizace je nepřenáší — odkaz se ruší (jen odkaz, ne cíl).
  for (const rel of vstup.odkazy) {
    await rm(path.join(n.cil, rel), { force: true });
    log(`symbolický odkaz „${rel}" ve vstupu ingestu zrušen — brána ho posoudit neumí a engine by ho následoval`);
  }

  // Zadržený soubor, který z karantény zmizel, už zadržený není.
  const karantenaSet = new Set(karantena.soubory);
  for (const rel of Object.keys(stav.zadrzeno)) {
    if (!karantenaSet.has(rel)) {
      delete stav.zadrzeno[rel];
      zmena = true;
    }
  }
  // Ověřený soubor, který ze vstupu zmizel, se z přehledu vyřadí (jinak by rostl donekonečna).
  const vstupSet = new Set(vstup.soubory);
  for (const rel of Object.keys(stav.overeno)) {
    if (!vstupSet.has(rel)) {
      delete stav.overeno[rel];
      zmena = true;
    }
  }

  // Fronta: (1) nové a změněné v karanténě + zadržené, kterým vypršel odstup,
  //         (2) co leží ve vstupu bez ověření.
  type Ukol = { rel: string; odkud: 'karantena' | 'vstup' };
  const fronta: Ukol[] = [];
  const naRade = new Set<string>();
  for (const rel of karantena.soubory) {
    const o = await otisk(path.join(n.karantena, rel)).catch(() => null);
    if (!o) continue; // zmizel mezi výpisem a otiskem
    const z = stav.zadrzeno[rel];
    // „Ještě ne" platí jen s platným časem dalšího pokusu. Záznam bez něj (stav zapsaný starší
    // podobou brány, ruční zásah) je na řadě hned: neplatný čas v porovnání `<= ted` by znamenal
    // „nikdy" — zadržení natrvalo, o kterém by nikdo nevěděl.
    if (!stejny(z, o) || !(Date.parse(z.dalsi) > ted)) {
      fronta.push({ rel, odkud: 'karantena' });
      naRade.add(rel);
    }
  }
  /** Soubory ve vstupu, které engine čte a jejichž dnešní obsah brána neposoudila. */
  const neoverene = new Set<string>();
  for (const rel of vstup.soubory) {
    const o = await otisk(path.join(n.cil, rel)).catch(() => null);
    if (!o || stejny(stav.overeno[rel], o)) continue;
    neoverene.add(rel);
    // Jmenovec v karanténě, který je v tomhle kole NA ŘADĚ, rozhodne za oba. Zadržený
    // jmenovec nerozhoduje nic — starý soubor ve vstupu engine čte dál, takže se posoudí sám.
    if (!naRade.has(rel)) fronta.push({ rel, odkud: 'vstup' });
  }

  /** Zapíše zadržení (nebo jeho další pokus) a řekne to. */
  const zadrz = (rel: string, o: Otisk, druh: Zadrzeny['druh'], duvod: string): void => {
    const drive = stav.zadrzeno[rel];
    const pokusu = stejny(drive, o) && drive.druh === druh ? drive.pokusu + 1 : 1;
    stav.zadrzeno[rel] = {
      ...o,
      verdikt: druh === 'nalez' ? 'infected' : 'rejected',
      druh,
      duvod,
      kdy: stejny(drive, o) ? drive.kdy : new Date(ted).toISOString(),
      pokusu,
      dalsi: new Date(ted + odstup(druh, pokusu)).toISOString(),
    };
    vysledek.zadrzeno += 1;
    zmena = true;
    log(
      druh === 'nalez'
        ? `NÁLEZ ${duvod}: „${rel}" zadržen v karanténě — do vstupu ingestu nevstoupí`
        : `„${rel}" nejde posoudit (${duvod}) — zadržen, další pokus ${stav.zadrzeno[rel].dalsi}`,
    );
  };
  const stuj = (proc: string, zbyva: number): void => {
    vysledek.ceka += zbyva;
    vysledek.bezPrekazky = false;
    vysledek.prekazka = proc;
    log(`${proc} — ${zbyva} souborů čeká, do vstupu nejde nic`);
  };

  try {
    vysledek.clamd = await ping({ host: n.clamd.host, port: n.clamd.port, timeoutMs: PING_TIMEOUT_MS });
    if (!vysledek.clamd) {
      if (fronta.length > 0) stuj(`clamd ${n.clamd.host}:${n.clamd.port} neodpovídá`, fronta.length);
      return vysledek;
    }

    for (let i = 0; i < fronta.length; i += 1) {
      const { rel, odkud } = fronta[i];
      const zdroj = path.join(odkud === 'karantena' ? n.karantena : n.cil, rel);
      let fh: FileHandle;
      try {
        fh = await open(zdroj, 'r');
      } catch (err) {
        const kod = (err as NodeJS.ErrnoException).code ?? '';
        if (kod === 'ENOENT') continue; // zmizel mezi výpisem a skenem
        // Nejde otevřít (práva, na cestě je mezitím složka): vada TOHOTO souboru, fronta jede dál.
        const o = await otisk(zdroj).catch(() => ({ size: -1, mtimeMs: -1 }));
        if (odkud === 'karantena') zadrz(rel, o, 'soubor', `nejde otevřít: ${kod || (err as Error).message}`);
        else log(`„${rel}" ve vstupu nejde otevřít (${kod || (err as Error).message}) — neposouzen`);
        continue;
      }
      try {
        // Otisk TOHO, co se opravdu skenuje (ne toho, co stálo na cestě při sestavování fronty).
        const o = otiskZ(await fh.stat());
        const verdikt: AvVerdict = await scan(obsahZ(fh), n.clamd);

        if (verdikt.status === 'clean') {
          if (odkud === 'karantena') {
            if (!(await zapisZ(fh, path.join(n.cil, rel), 0o644, o))) {
              vysledek.ceka += 1; // změnil se během přenosu — posoudí se celý znovu příští kolo
              continue;
            }
            await smazPokudTyz(zdroj, fh);
          } else if (!stejny(o, otiskZ(await fh.stat()))) {
            vysledek.ceka += 1; // přepsán na místě během skenu — verdikt patří jinému obsahu
            continue;
          }
          stav.overeno[rel] = o;
          neoverene.delete(rel);
          delete stav.zadrzeno[rel];
          vysledek.propusteno += 1;
          zmena = true;
          continue;
        }

        let druh: Zadrzeny['druh'];
        let duvod: string;
        if (verdikt.status === 'infected') {
          druh = 'nalez';
          duvod = verdikt.signature;
        } else if (verdikt.kind === 'size_limit') {
          druh = 'nad_limit'; // clamd odpověděl — vada je v souboru, vždy
          duvod = verdikt.reason;
        } else if (verdikt.kind === 'source') {
          druh = 'soubor';
          duvod = verdikt.reason;
        } else {
          // Čas, zavřené spojení, jiná chyba clamd: soubor, nebo platforma? Rozhodne kontrolní vzorek.
          const zije = await ping({ host: n.clamd.host, port: n.clamd.port, timeoutMs: PING_TIMEOUT_MS });
          const vzorek = zije
            ? await scanBuffer(VZOREK, { host: n.clamd.host, port: n.clamd.port, timeoutMs: VZOREK_TIMEOUT_MS })
            : null;
          if (vzorek?.status !== 'clean') {
            stuj(
              zije
                ? `clamd odpovídá na PING, ale neposoudil ani kontrolní vzorek (${verdikt.reason})`
                : `clamd přestal odpovídat uprostřed kola (${verdikt.reason})`,
              fronta.length - i,
            );
            break;
          }
          druh = 'soubor';
          duvod = verdikt.reason;
        }

        // Do vstupu nesmí. Leží-li tam z doby před branou, stáhnout — ať ho engine dál nečte.
        if (odkud === 'vstup') {
          const drziJmenovec = karantenaSet.has(rel);
          const kam = drziJmenovec ? path.join(n.stav, STAZENO_DIR, rel) : path.join(n.karantena, rel);
          if (!(await zapisZ(fh, kam, 0o644, o))) {
            vysledek.ceka += 1;
            continue;
          }
          await smazPokudTyz(zdroj, fh);
          neoverene.delete(rel);
          delete stav.overeno[rel];
          if (drziJmenovec) {
            // Místo v karanténě drží zadržená NOVĚJŠÍ verze téhož jména — ta rozhoduje dál;
            // starý soubor se jen odklidí z dosahu enginu a zapíše se, že a proč.
            stav.stazeno[rel] = { duvod, kdy: new Date(ted).toISOString() };
            vysledek.zadrzeno += 1;
            zmena = true;
            log(`„${rel}" stažen ze vstupu (${duvod}) — jeho místo v karanténě drží zadržená novější verze`);
            continue;
          }
        }
        zadrz(rel, o, druh, duvod);
      } catch (err) {
        if (err instanceof ChybaZapisu && err.kdo === 'platforma') {
          stuj(`zápis selhal (${err.message})`, fronta.length - i);
          break;
        }
        // Vada tohoto souboru (na jeho místě stojí složka, čtení selhalo…): zadržet a jet dál.
        const o = await fh.stat().then(otiskZ, () => ({ size: -1, mtimeMs: -1 }));
        const duvod = err instanceof Error ? err.message : String(err);
        if (odkud === 'karantena') zadrz(rel, o, 'soubor', duvod);
        else log(`„${rel}" ve vstupu nejde zpracovat (${duvod}) — neposouzen`);
      } finally {
        await fh.close().catch(() => undefined);
      }
    }

    return vysledek;
  } finally {
    // Přehled a stav se zapíšou VŽDY — i když kolo skončilo překážkou nebo výjimkou.
    const drzene = Object.values(stav.zadrzeno);
    vysledek.drzeno = {
      nalezy: drzene.filter((z) => z.druh === 'nalez').length,
      neposouditelne: drzene.filter((z) => z.druh !== 'nalez').length,
      nejstarsi: drzene.map((z) => z.kdy).sort()[0] ?? null,
    };
    vysledek.neovereno = neoverene.size;
    if (zmena) await ulozStav(n.stav, stav);
  }
}

/** Přečte konfiguraci z prostředí; vrací ji, nebo seznam toho, co chybí. Nic nedomýšlí. */
export function nastaveniZProstredi(env: NodeJS.ProcessEnv): { n: Nastaveni; interval: number } | { chybi: string[] } {
  const chybi: string[] = [];
  const text = (jmeno: string): string => {
    const v = (env[jmeno] ?? '').trim();
    if (!v) chybi.push(jmeno);
    return v;
  };
  const cislo = (jmeno: string): number => {
    const v = Number.parseInt(text(jmeno), 10);
    if (!Number.isInteger(v) || v <= 0) {
      if (!chybi.includes(jmeno)) chybi.push(`${jmeno} (kladné celé číslo)`);
      return 0;
    }
    return v;
  };
  const karantena = text('DOCS_SCAN_QUARANTINE');
  const cil = text('DOCS_SCAN_TARGET');
  const stav = text('DOCS_SCAN_STATE');
  const host = text('CLAMD_HOST');
  const port = cislo('CLAMD_PORT');
  const interval = cislo('DOCS_SCAN_INTERVAL');
  if (chybi.length > 0) return { chybi };
  return { n: { karantena, cil, stav, clamd: { host, port, timeoutMs: SCAN_TIMEOUT_MS } }, interval };
}

/**
 * Co po kole říct a jestli zapsat tep. Oddělené od smyčky, aby šlo měřit: healthcheck
 * kontejneru stojí na tom, že tep vznikne JEN v kole bez překážky.
 */
export async function poKole(k: Kolo, tep: string, ted: number): Promise<string[]> {
  if (k.bezPrekazky) await zapisAtomicky(tep, String(Math.floor(ted / 1000)));
  const radky: string[] = [];
  if (k.propusteno > 0 || k.zadrzeno > 0 || k.ceka > 0) {
    radky.push(`kolo: propuštěno ${k.propusteno}, zadrženo ${k.zadrzeno}, čeká ${k.ceka}`);
  }
  if (k.drzeno.nalezy + k.drzeno.neposouditelne > 0) {
    radky.push(
      `drženo v karanténě: ${k.drzeno.nalezy} nálezů, ${k.drzeno.neposouditelne} neposouditelných ` +
        `(nejstarší od ${k.drzeno.nejstarsi}) — podrobnosti ve stav.json`,
    );
  }
  if (k.neovereno > 0) {
    radky.push(`ve vstupu ingestu leží ${k.neovereno} souborů, které brána ještě neposoudila — engine je čte`);
  }
  const p = k.preskoceno;
  if (p.teckove + p.rozepsane + p.odkazy > 0) {
    radky.push(`nejsou dokumenty: ${p.teckove} tečkových jmen, ${p.rozepsane} rozepsaných stažení, ${p.odkazy} odkazů`);
  }
  return radky;
}

async function main(): Promise<void> {
  let konec = false;
  let probud: () => void = () => undefined;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      console.log(`[docs-scan] ${sig} — končím`);
      konec = true;
      probud();
    });
  }
  const spi = (sekund: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, sekund * 1000);
      probud = () => {
        clearTimeout(t);
        resolve();
      };
    });

  const cfg = nastaveniZProstredi(process.env);
  if ('chybi' in cfg) {
    // ⛔ NEKONČIT: restartovací smyčka sidecaru vyčerpá limit restartů a shodí celý stack
    // (ingest i dopravu balíčků). Bez konfigurace se neskenuje, tep se nepíše — kontejner
    // je NEZDRAVÝ a říká proč. Do vstupu enginu mezitím nevstoupí nic (docs-sync píše jen
    // do karantény).
    while (!konec) {
      console.error(`[docs-scan] FATAL: není doručeno ${cfg.chybi.join(', ')} — neskenuji a nehádám; do vstupu nejde nic.`);
      await spi(600);
    }
    return;
  }

  // Totéž hlášení nejvýš jednou za hodinu — „clamd neodpovídá" nebo přehled drženého by jinak
  // plnily log každé kolo; hodina je zároveň rytmus, ve kterém se přehled připomíná.
  const videno = new Map<string, number>();
  const jednou = (z: string): void => {
    const ted = Date.now();
    if (ted - (videno.get(z) ?? 0) < 3_600_000) return;
    videno.set(z, ted);
    console.log(`[docs-scan] ${z}`);
  };
  const n: Nastaveni = { ...cfg.n, log: jednou };
  const tep = path.join(n.stav, 'tep');
  await mkdir(n.stav, { recursive: true });
  console.log(`[docs-scan] karanténa ${n.karantena} → clamd ${n.clamd.host}:${n.clamd.port} → vstup ${n.cil}; stav ${n.stav}`);

  let naposledClamd: boolean | null = null;
  while (!konec) {
    try {
      const k = await kolo(n);
      for (const radek of await poKole(k, tep, Date.now())) jednou(radek);
      if (k.clamd !== naposledClamd) {
        console.log(`[docs-scan] clamd ${k.clamd ? 'odpovídá' : 'NEODPOVÍDÁ'}`);
        naposledClamd = k.clamd;
      }
    } catch (err) {
      // Chyba kola (nečitelný stav, plný disk stavu) nesmí shodit PID 1 do restartovací smyčky,
      // ale tep se nezapíše — healthcheck to ukáže.
      console.error(`[docs-scan] kolo selhalo: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (konec) break;
    await spi(cfg.interval);
  }
}

// Spuštěno jako program (ne importováno testem).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
