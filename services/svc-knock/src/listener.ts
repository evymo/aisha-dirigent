/**
 * Naslouchání zaťukání — jeden UDP datagram, žádná odpověď.
 *
 * ⭐ NIKDY NEODPOVÍDÁ (invariant K2)
 * Ani na platný knock, ani na nesmysl. Port je tak zvenčí k nerozeznání od
 * zavřeného (T3) a nedá se použít k amplifikaci ani ke skenování. Zpětnou vazbu
 * dostane uživatel z DRUHÉHO kroku — když se pak zkusí připojit a povede se to.
 *
 * ⭐ CO TAHLE SLUŽBA NEDĚLÁ
 * Nerozhoduje o přístupu k jednotlivým službám a nezná uživatele. Jen ověří, že
 * odesílatel drží pověření, a zapíše jeho adresu do sdílené mapy dveří. Kdo je
 * ten člověk, řeší Keycloak — až za dveřmi.
 */
import dgram from 'node:dgram';
import { decodeFrame, type Operator } from '@aisha/knock-protocol';
import { authenticateFrame } from './auth.js';
import type { Door } from '@aisha/knock-protocol/door';
import type { KnockConfig } from './config.js';
import type { Defense } from './lib/defense.js';

export type LogFn = (o: Record<string, unknown>) => void;

/**
 * Paměť viděných nonce — anti-replay.
 *
 * ⚠️ Je v procesu, ne ve sdíleném úložišti: při více instancích listeneru by
 * přehrání proklouzlo na tu druhou. Dokud běží jedna, je to správně; jakmile
 * jich bude víc, musí se to přesunout vedle mapy dveří. Zapsáno, ne zamlčeno.
 */
export function createNonceCache(windowSec: number) {
  const seen = new Map<string, number>();
  return (nonce: string, nowSec: number): boolean => {
    for (const [k, exp] of seen) if (exp < nowSec) seen.delete(k);
    if (seen.has(nonce)) return true;
    seen.set(nonce, nowSec + windowSec * 2);
    return false;
  };
}

export interface HandlerDeps {
  cfg: KnockConfig;
  door: Door;
  defense: Defense;
  log: LogFn;
  nonceSeen: (nonce: string, nowSec: number) => boolean;
  /** Doručení podnětů (nový kód, podezřelá síť). Bez něj se jen loguje. */
  notify?: (payload: Record<string, unknown>) => void;
  now?: () => number;
}

export function createHandler(deps: HandlerDeps) {
  const { cfg, door, defense, log } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  /** Jediné místo, kudy odchází zahození — ať se audit ani obrana nedají obejít. */
  function drop(reason: string, fields: Record<string, unknown>): void {
    const src = fields.src as string | undefined;
    log({ ev: 'drop', reason, ...fields });
    if (!src) return;
    const nowSec = now();
    const r = defense.recordInvalid(src, nowSec, reason, (fields.kid as string) ?? null);
    if (r.cooldownStarted) log({ ev: 'cooldown', src, until: r.until, afterInvalid: r.after });
    if (r.alert) {
      const payload = {
        ev: 'neighbour-activity', ip: src, badKnocks: r.count, lastReason: r.reason,
        doporuceni: 'Ze sítě, ze které se připojujete, se někdo pokouší o přístup. ' +
          'Doporučujeme připojit se z důvěryhodnějšího místa.',
      };
      log(payload);
      deps.notify?.(payload);
    }
    // ⭐ Klíč sedí, kód ne — zařízení klepe SAMO a nemá jak zjistit, že mu kód
    // dosloužil (listener neodpovídá). Tohle je ten okamžik: uživatel má telefon
    // v ruce, protože se právě pokusil dostat dovnitř.
    // ⚠️ Posílá se SIGNÁL, ne kód — kód vydává správa rosteru druhým kanálem.
    if (r.sendFreshCode) {
      const payload = { ev: 'fresh-code-due', kid: fields.kid, ip: src, reason };
      log(payload);
      deps.notify?.(payload);
    }
    if (r.freshCodeThrottled) log({ ev: 'fresh-code-throttled', kid: fields.kid, src, reason });
  }

  return async function handle(msg: Uint8Array, src: string): Promise<void> {
    const nowSec = now();

    // Rate-limit PŘED jakoukoli prací: při zaplavení se nemá počítat podpis.
    // Zahození je tiché jako každé jiné, takže K2/T3 platí dál.
    if (defense.check(src, nowSec).blocked) return;

    if (cfg.diagnose) {
      // Měřicí režim: řekne, CO doletělo a odkud — a nic neotevře, protože
      // strukturálně nemá čím (start bez operátorů, viz configDefects).
      log({ ev: 'rx', src, len: msg.length, hex: Buffer.from(msg.subarray(0, 32)).toString('hex') });
      return;
    }

    // Zakázané místo se zahodí hned a VŽDY zaznamená — zákaz je výslovné
    // rozhodnutí operátora a ten musí vidět, jestli se do něj někdo opírá.
    if (cfg.blacklist.includes(src)) {
      log({ ev: 'drop', reason: 'blacklist', src });
      defense.recordInvalid(src, nowSec, 'blacklist');
      return;
    }

    let frame;
    try {
      frame = decodeFrame(msg);
    } catch (e) {
      return drop(`decode:${e instanceof Error ? e.message : String(e)}`, { src });
    }

    // Rozhodnutí „pustit dál" má jedno pojmenované místo — viz `auth.ts`.
    //
    // ⛔ PORUCHA OVĚŘOVATELE JE NAŠE VADA, NE ODESÍLATELOVA.
    //
    // `ecdsaP256Verify` nově VYHAZUJE, když se rozbije ověřovatel sám (změna
    // API Node, došlá paměť) — dřív z toho dělal `false`, tedy „podpis nesedí",
    // což je na dveřích ta nejhorší záměna: tváří se, že měříme, a neměříme.
    // Tady je druhá půlka té opravy, protože samotné vyhození by mělo dva
    // nechtěné následky:
    //
    //   1. `decodeFrame` výš svůj `try` má, tenhle řádek ne — výjimka
    //      v obsluze `dgram` zprávy je `uncaughtException`, tedy SPADLÝ DÉMON.
    //      Dveře by přestaly odpovídat úplně: z naší poruchy by byla nedostupnost.
    //   2. `drop()` krmí `defense.recordInvalid`, takže by se cizí porucha
    //      počítala ODESÍLATELI a nevinný klient by si vysloužil cooldown
    //      i zápis mezi sousedskou aktivitu.
    //
    // Proto: zavřeno (paket se zahodí), NAHLAS (vlastní událost, ne mezi
    // běžnými `drop`), a BEZ POSTIHU odesílatele.
    let v;
    try {
      v = authenticateFrame(frame, cfg, nowSec, (n) => deps.nonceSeen(n, nowSec));
    } catch (e) {
      log({
        ev: 'verifier-fault',
        chyba: e instanceof Error ? e.message : String(e),
        kid: frame.kid,
        scope: frame.scope,
        src,
        doporuceni: 'Ověřovatel podpisu selhal — to NENÍ neplatný podpis. ' +
          'Zaťukání se nepropouští, ale odesílatel za to nemůže. Zkontroluj běhové ' +
          'prostředí svc-knock (verze Node, paměť).',
      });
      return;
    }
    if (!v.ok) return drop(v.reason, { kid: frame.kid, scope: frame.scope, src });

    // Adresa v rámci (`ipFam`) umí otevřít JINOU adresu, než ze které knock
    // přišel — proto se blacklist a omezení operátora testují na TU, která se
    // opravdu otevírá. Jinak by šel zákaz obejít uvedením cílové adresy v rámci.
    const openIp = frame.ipFam === 0 ? src : (frame.ip ?? src);
    if (cfg.blacklist.includes(openIp)) return drop('blacklist', { kid: frame.kid, openIp, src });

    const op: Operator | undefined = cfg.operators[frame.kid];
    if (op?.allowedIps?.length && !op.allowedIps.includes(openIp))
      return drop('ip-not-allowed', { kid: frame.kid, openIp, src });

    // Úspěch chrání zdroj před cooldownem: legitimního uživatele nesmí
    // odstřihnout někdo, kdo si jeho adresu podvrhne do zdrojového pole.
    defense.recordSuccess(src, nowSec);

    const zapsano = await door.open(openIp, frame.kid);
    log({
      ev: zapsano ? 'OPEN' : 'OPEN-FAILED', kid: frame.kid, scope: frame.scope,
      device: op?.device, openIp, ttl: cfg.pinholeTtlSec,
      ...(zapsano ? {} : { pozn: 'mapa dveří nepřijala zápis — uživatel se dovnitř NEDOSTANE' }),
    });
    // POZOR: nikdy se neposílá odpověď (K2).
  };
}

export function startListener(cfg: KnockConfig, handle: (msg: Uint8Array, src: string) => Promise<void>, log: LogFn) {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    void handle(new Uint8Array(msg), rinfo.address).catch((e) =>
      log({ ev: 'error', where: 'handle', err: e instanceof Error ? e.message : String(e) }),
    );
  });
  sock.on('error', (e) => {
    log({ ev: 'error', where: 'socket', err: e.message });
    process.exit(1);
  });
  sock.bind(cfg.port, cfg.bindHost, () => {
    // Hlásí se port, na kterém socket SKUTEČNĚ sedí — u `port 0` se přiděluje
    // až při bindu a log, který by opakoval vstup, by tu nic neměřil.
    const a = sock.address();
    log({
      ev: 'listen', host: a.address, port: a.port, diagnose: cfg.diagnose,
      operators: Object.keys(cfg.operators), staticAllow: cfg.staticAllow, blacklist: cfg.blacklist,
    });
  });
  return sock;
}
