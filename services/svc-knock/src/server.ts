/**
 * svc-knock — naslouchá zaťukání na dveře a zapisuje otevřené adresy do sdílené mapy.
 *
 * PROČ SAMOSTATNÝ KONTEJNER
 * Klepe se **jen a pouze přes UDP**, protože se nemá dát najevo, kam se klepe.
 * HTTPS routa by byla adresa, která o sobě dá vědět — tedy pravý opak dveří,
 * jejichž celá hodnota je v tom, že jsou k nerozeznání od zdi.
 *
 * Tahle služba jako jediná ve stacku poslouchá na VEŘEJNÉM UDP portu. Držet ji
 * stranou znamená, že její kompromitace nebere s sebou nic jiného.
 *
 * ⭐ OVĚŘENÍ VOLAJÍCÍHO JE HMAC PODPIS RÁMCE, ne hlavička.
 * Datagram nemá session a listener na něj neodpovídá, takže jediné, čím se
 * odesílatel prokáže, je podpis počítaný klíčem z rosteru — ověřuje se
 * v konstantním čase v `verifyFrame` (viz `listener.ts`). HTTP rozhraní téhle
 * služby je jen zdraví pro healthcheck a metriky; nic se přes ně neotevírá.
 *
 * CO NEDĚLÁ: nerozhoduje o přístupu ke službám a nezná uživatele. Kdo je ten
 * člověk, řeší Keycloak — až za dveřmi.
 */
import Fastify from 'fastify';
import { applySecurity, createSafeLogger, createSsrfGuard } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { createNamespacedRedis } from '@aisha/cache-redis/client';
import { createDoor } from '@aisha/knock-protocol/door';
import { clientIpFrom, parseTrusted } from '@aisha/knock-protocol';
import { configDefects, loadConfig, num, type KnockConfig } from './config.js';
import { spustObnovuRosteru, type Obnova } from './roster.js';
import { createDefense } from './lib/defense.js';
import { createHandler, createNonceCache, startListener, type LogFn } from './listener.js';

const { safeInfo, safeWarn, safeError } = createSafeLogger('svc-knock');

/** Audit listeneru jde přes bezpečný logger — ne přes `console`, ať se nic neprosype do logů syrové. */
const log: LogFn = (o) => safeInfo(String(o.ev ?? 'ev'), o);

export interface StavDveri {
  doorReady: boolean;
  /** Roster z adresy dorazil. `undefined` = roster z adresy se nepoužívá. */
  rosterReady?: boolean;
  /** Základ z prostředí (technici) nese aspoň jeden kód. */
  zakladMa?: boolean;
}

export async function buildHealthApp(
  cfg: KnockConfig,
  /**
   * Stav pro `/ready`. Smí být asynchronní: `doorReady` je SKUTEČNÝ `PING` do mapy
   * (door.ping), ne existence klienta — ta je pravdivá i v mrtvém netns.
   */
  stav: () => StavDveri | Promise<StavDveri>,
  /**
   * Verdikt nad adresou. Předává se, ne importuje: tentýž `door`, do kterého
   * listener ZAPISUJE, tady ODPOVÍDÁ. Kdyby si tenhle modul otevřel vlastní
   * spojení, byla by to druhá mapa a rozdíl by nikdo neviděl.
   */
  verdikt?: (ip: string) => Promise<{ allowed: boolean }>,
  /** Správa nájmu adresy — TÝŽ `door`, který mapu píše. Ne druhé spojení. */
  najem?: { prodluz: (ip: string) => Promise<boolean>; zavri: (ip: string) => Promise<boolean> },
) {
  const app = Fastify({ logger: { level: cfg.logLevel }, trustProxy: true });
  await applySecurity(app, {
    service: 'svc-knock',
    // Žádný cizí původ: na tohle rozhraní sahá healthcheck kontejneru, ne prohlížeč.
    cors: { allowlist: '' },
    rateLimit: { enabled: true, max: 60, timeWindow: 60_000 },
    skipErrorHandler: true,
  });
  await registerMetricsPlugin(app, { serviceName: 'svc-knock' });

  app.get('/health', async () => ({
    status: 'ok',
    operators: Object.keys(cfg.operators).length,
    diagnose: cfg.diagnose,
  }));

  // Zdraví JE dostupnost mapy: listener, který přijímá knocky a nemá je kam
  // zapsat, vypadá živě a přitom nikoho nepustí dovnitř. To je tichý výpadek,
  // tedy ten nejhorší druh — proto se přiznává stavovým kódem.
  app.get('/ready', async (_req, reply) => {
    const { doorReady, rosterReady, zakladMa } = await stav();
    if (!doorReady) {
      reply.code(503);
      return { status: 'unavailable', door: 'down' };
    }
    // Roster z adresy, který ještě nedorazil, je totéž mlčení o patro výš:
    // listener přijímá knocky a nemá je podle čeho ověřit, takže neotevře
    // nikomu. Přiznává se to stejným způsobem jako výpadek mapy.
    if (rosterReady === false) {
      // Se základem z prostředí dveře technikům otevřou i bez rosteru z adresy
      // (tablety jen zatím nezaťukají samy). Přizná se to v těle, ne 503 —
      // healthcheck kontejneru by jinak shodil dveře i lidem, kteří je jdou opravit.
      if (zakladMa) return { status: 'degraded', door: 'up', roster: 'jen-zaklad' };
      reply.code(503);
      return { status: 'unavailable', door: 'up', roster: 'down' };
    }
    return { status: 'ok', door: 'up' };
  });

  /**
   * DVEŘE PRO EDGE — `forward_auth`.
   *
   * Zadání majitele 2026-09-01: „celý edge zavřít, na všech úrovních —
   * nezaklepeš, dveře se neotevřou, a teprve pak se můžeš přihlásit."
   *
   * Rozhoduje se TADY, u zapisovatele mapy, ne v bráně o dům dál. Brána hlídala
   * jednu plochu z osmi a vnitřní provoz jí chodil mimo — tady je každý
   * požadavek zvenku, protože jinudy edge nikoho nepustí.
   *
   * ⛔ Adresa se bere ZPRAVA přes seznam našich prvků, ne z první položky:
   * co si klient do hlavičky napíše sám, zůstane VLEVO od toho, co dopsal
   * HAProxy, a chůze se k tomu nedostane. `null` = adresu nešlo odvodit ⇒
   * ZAVŘENO; nedosazuje se adresa socketu, ta by ukazovala na Caddy, tedy na nás.
   *
   * 204 = pusť, 403 = odřízni. Tělo je prázdné schválně: kdo neťukal, nemá se
   * dozvědět ani to, co je za dveřmi.
   */
  const duveryhodne = parseTrusted(cfg.trustedProxies.split(','));
  app.get('/dvere', async (req, reply) => {
    if (!verdikt) { reply.code(503); return ''; }
    const ip = clientIpFrom(req.headers['x-forwarded-for'], duveryhodne);
    if (ip === null) { reply.code(403); return ''; }
    const v = await verdikt(ip);
    reply.code(v.allowed ? 204 : 403);
    return '';
  });

  /**
   * NÁJEM ADRESY — prodloužení a zavření.
   *
   * Rozhodnutí majitele 2026-09-01: „přihlášení whitelistuje uživatelovu IP na
   * edge — dokud je přihlášen, nebo dokud ho neodhlásíš z KC."
   *
   * ⛔ ADRESA SE NEBERE Z TĚLA. Volající posílá PŮVODNÍ `x-forwarded-for`
   * a klient se z něj odvodí TOUŽ chůzí jako u verdiktu. Kdyby se posílala
   * hodnotou, kdokoli uvnitř sítě by uměl otevřít libovolnou adresu — a
   * zaťukání by přestalo být podmínkou.
   *
   * ⛔ PRODLOUŽENÍ NEOTEVÍRÁ. `door.prodluz` na neotevřené adrese vrátí false;
   * otevřít smí JEN podepsané klepnutí. Jinak by platný token z cizí sítě
   * stačil na vstup.
   */
  app.post('/dvere/prodluz', async (req, reply) => {
    if (!najem) { reply.code(503); return ''; }
    const ip = clientIpFrom(req.headers['x-forwarded-for'], duveryhodne);
    if (ip === null) { reply.code(400); return ''; }
    reply.code((await najem.prodluz(ip)) ? 204 : 409);
    return '';
  });

  app.post('/dvere/zavri', async (req, reply) => {
    if (!najem) { reply.code(503); return ''; }
    const ip = clientIpFrom(req.headers['x-forwarded-for'], duveryhodne);
    if (ip === null) { reply.code(400); return ''; }
    await najem.zavri(ip);
    reply.code(204);
    return '';
  });

  return app;
}

async function main(): Promise<void> {
  // OTel se musí připojit DŘÍV, než kterýkoli modul sáhne na síť.
  bootstrapOtel({ serviceName: 'svc-knock' });

  const vady = configDefects();
  if (vady.length > 0) {
    // Fail-closed: služba s polovinou konfigurace by se tvářila, že hlídá dveře,
    // a přišlo by se na to, až by se někdo nedostal dovnitř (nebo dostal).
    safeError('svc-knock NESTARTUJE', new Error(vady.join('; ')));
    process.exit(1);
  }
  const cfg = loadConfig();

  const redis = createNamespacedRedis({ db: cfg.redisDb, url: cfg.redisUrl, connectionName: 'svc-knock-door' });
  const door = createDoor({
    redis,
    staticAllow: parseTrusted(cfg.staticAllow),
    blacklist: parseTrusted(cfg.blacklist),
    ttlSec: cfg.pinholeTtlSec,
    // Výpadek mapy se musí ozvat: bez toho by dveře tiše nikoho nepustily
    // (nebo po odvolání nezavřely) a vypadalo by to jako klid.
    onError: (op, err) => safeError(`dveře: úložiště selhalo (${op})`, err),
  });
  if (!door.hasStore()) {
    // Říct nahlas: bez mapy platí jen statické výjimky (K4), nic jiného se
    // neotevře. Mlčení by z toho udělalo záhadu „klepu a nic".
    safeWarn('door-store-disabled', { pozn: 'jede jen staticAllow (K4); zaťukání nikoho neotevře' });
  }

  const defense = createDefense({
    maxInvalid: cfg.maxInvalid, windowSec: cfg.rateWindowSec,
    cooldownSec: cfg.cooldownSec, recentOkSec: cfg.recentOkSec,
  });

  const handle = createHandler({
    cfg, door, defense, log,
    nonceSeen: createNonceCache(cfg.windowSec),
    notify: cfg.alertWebhook ? (payload) => void odeslatPodnet(cfg.alertWebhook, payload) : undefined,
  });

  // Roster z adresy: první kolo se odbaví PŘED nasloucháním, ať se nezahodí
  // knock, který dorazí v prvních sekundách. Když se nepodaří, startuje se
  // stejně — dokud roster nedorazí, nikoho to neotevře a /ready to přizná.
  let obnova: Obnova | null = null;
  // Základ z prostředí (kódy techniků) — zmrazený při startu; roster z adresy
  // se k němu PŘIDÁVÁ a nepřepíše ho (roster.ts, spojSeZakladem).
  const zaklad = { ...cfg.operators };
  if (cfg.operatorsUrl) {
    obnova = spustObnovuRosteru(
      {
        url: cfg.operatorsUrl,
        versionUrl: cfg.operatorsVersionUrl,
        token: cfg.operatorsToken,
        intervalSec: cfg.operatorsRefreshSec,
      },
      {
        // Mapa se VYMĚŇUJE celá, nemutuje se po klíčích: ověřování si ji čte
        // při každém knocku, takže by jinak mohlo vidět rozdělaný stav.
        nastav: (operators) => { cfg.operators = operators; },
        log: (u) => log(u),
        zaklad,
        // Odvolané zařízení: dírka se zavře hned, ne až po vypršení nájmu.
        odvolano: (kid) => {
          void door.closeForKid(kid).then((n) => log({ ev: 'roster-odvolano-zavreno', kid, adres: n }));
        },
      },
    );
    await obnova.kolo();
    if (!obnova.pripraven()) {
      safeWarn('roster-jeste-nedorazil', { pozn: 'listener bezi, ale zatukani zatim nikoho neotevre' });
    }
  }

  const sock = startListener(cfg, handle, log);
  const app = await buildHealthApp(
    cfg,
    async () => ({
      doorReady: await door.ping(),
      rosterReady: cfg.operatorsUrl ? obnova?.pripraven() ?? false : undefined,
      zakladMa: Object.keys(zaklad).length > 0,
    }),
    (ip) => door.verdict(ip),
    { prodluz: (ip) => door.prodluz(ip), zavri: (ip) => door.close(ip) },
  );
  await app.listen({ port: num(process.env.SPA_HEALTH_PORT, 3017), host: '0.0.0.0' });

  const zavri = (): void => {
    obnova?.stop();
    sock.close();
    app.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', zavri);
  process.on('SIGINT', zavri);
}

/**
 * Podnět ven — SIGNÁL, nikdy ne kód.
 *
 * Adresa přichází z prostředí, takže se na ni nesmí sáhnout holým klientem:
 * překlep nebo podvržená hodnota by udělaly z listeneru nástroj, kterým se dá
 * ťukat na vnitřní služby. Proto přes SSRF strážce a selhání se hlásí, ne polyká.
 */
function guardProUrl(url: string) {
  // Povolený hostitel se ODVOZUJE z nastavené adresy, nezadává se druhou
  // proměnnou: dvě místa s toutéž znalostí se rozejdou, a rozejdou se tiše.
  // Chybný tvar adresy se odmítne hned — ne až prvním podnětem, který se ztratí.
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (!host) throw new Error(`SPA_ALERT_WEBHOOK není adresa: ${url.slice(0, 60)}`);
  return createSsrfGuard({
    service: 'svc-knock',
    hostAllowlist: [host],
    allowedSchemes: url.startsWith('http://') ? ['https:', 'http:'] : ['https:'],
    allowInternalNetworks: true,
  });
}

async function odeslatPodnet(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await guardProUrl(url).safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) safeWarn('webhook-status', { code: res.status });
  } catch (e) {
    safeWarn('webhook-failed', { err: e instanceof Error ? e.message : String(e) });
  }
}

// Spustit jen jako program, ne při importu z testu.
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  main().catch((e) => { safeError('svc-knock: pád při startu', e); process.exit(1); });
}
