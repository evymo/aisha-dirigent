/**
 * Každé odmítnutí brokeru nese STROJOVÝ důvod a broker ho zaloguje jedním řádkem.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (fork riq po nasazení): běh pluginu dostal 9× 403 na
 * /sandbox/fetch a 1× 403 na /sandbox/rpc a důvod nezapsal runner ani broker —
 * co bylo špatně, je NEZMĚŘENO.
 *
 * Měří se skutečný broker (fastify, logger služby do zachytávacího proudu) nad
 * skutečným @aisha/postgrest-client a @aisha/security. Databáze je falešný
 * PostgREST na loopbacku; dodavatel (93.184.216.34) je podvržený fetch; cokoli
 * jiného, co by odešlo ven (push, LLM router), se zapíše a test ho vidí.
 * Hostitelé jsou IP literály, takže DNS lookup nejde do sítě.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const BROKER_SECRET = 'test-broker-secret-at-least-32-chars-long!!';
process.env.BROKER_TOKEN_SECRET = BROKER_SECRET;
process.env.POSTGREST_SERVICE_TOKEN = 'service-token';
// Proměnné služby: dodavatel + loopback (jen kvůli větvi ip_blokovana). RPC whitelist platí pro jiné
// druhy běhu A ZÁROVEŇ zužuje politiku plugin-exec (průnik) — proto v něm jsou i RPC z politiky.
process.env.PLUGIN_NETWORK_ALLOWLIST = '93.184.216.34,127.0.0.1';
process.env.PLUGIN_RPC_WHITELIST = 'povolena_fn,wd_upsert_drivers_audited,audience_sync_source_catalog';

const DODAVATEL = 'https://93.184.216.34';

/** Shim je jiný balíček — cesta se skládá za běhu, aby ji tsc služby (rootDir ./src) nesledoval. */
const SHIM_BROKER = fileURLToPath(new URL('../../../../images/plugin-exec/shim/src/broker.ts', import.meta.url));
interface ShimCtx {
  rpc: (fn: string, params: Record<string, unknown>) => Promise<unknown>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

// ── falešný PostgREST ────────────────────────────────────────────────────────
const db = {
  politika: {} as Record<string, unknown>,
  porucha: new Set<string>(),
  volani: [] as string[],
};
/** Chybová zpráva PostgRESTu, která (jako constraint error) ozvěnou nese hodnotu parametru. */
const DLOUHA_CHYBA = `duplicate key value violates unique constraint, Key (vin)=(TAJNA_HODNOTA_PARAMETRU) ${'x'.repeat(260)}`;

function postgrest(req: IncomingMessage, res: ServerResponse): void {
  req.resume();
  req.on('end', () => {
    const fn = (req.url ?? '').replace(/^\/rpc\//, '');
    db.volani.push(fn);
    const json = (stav: number, telo: unknown) => {
      res.writeHead(stav, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(telo));
    };
    if (db.porucha.has(fn)) return json(500, { code: '23505', message: DLOUHA_CHYBA });
    if (fn === 'get_plugin_sandbox_policy') return json(200, db.politika);
    if (fn === 'get_plugin_runtime_config') return json(200, {});
    return json(200, { ok: true });
  });
}

// ── síť ven: dodavatel podvržený, zbytek se jen zapíše ──────────────────────
const upstream = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const vencovni: string[] = [];
const realFetch = globalThis.fetch;
function sit(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  if (url.startsWith(DODAVATEL)) return upstream(url, init);
  vencovni.push(url);
  return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

// ── log služby ───────────────────────────────────────────────────────────────
const logRadky: string[] = [];
const logProud = new Writable({
  write(chunk: Buffer, _enc, hotovo) {
    logRadky.push(...chunk.toString('utf8').split('\n').filter(Boolean));
    hotovo();
  },
});
const odmitnutiVLogu = () =>
  logRadky.map((r) => JSON.parse(r) as Record<string, unknown>).filter((r) => r.odmitnuti === true);

async function token(claims: Record<string, unknown>): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('run-7')
    .setAudience('aisha-plugin-broker')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(BROKER_SECRET));
}

describe('broker: každé odmítnutí nese strojový důvod a jeden řádek v logu', () => {
  const dbServer = createServer(postgrest);
  let app: import('fastify').FastifyInstance;
  let DUVODY: Record<string, number>;
  let vycisti: () => void;
  let behPluginu: string;
  let jinyBeh: string;
  let shim: ShimCtx;

  beforeAll(async () => {
    await new Promise<void>((ok) => dbServer.listen(0, '127.0.0.1', ok));
    process.env.POSTGREST_URL = `http://127.0.0.1:${(dbServer.address() as AddressInfo).port}`;
    vi.stubGlobal('fetch', sit);
    const Fastify = (await import('fastify')).default;
    const broker = await import('../routes/broker.js');
    DUVODY = (broker as unknown as { DUVODY_ODMITNUTI: Record<string, number> }).DUVODY_ODMITNUTI ?? {};
    ({ vyprazdnitMezipamet: vycisti } = await import('../sandbox-politika.js'));
    app = Fastify({ logger: { level: 'info', stream: logProud } });
    await app.register(broker.sandboxBrokerRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    behPluginu = await token({ kind: 'plugin-exec', source_ref: 'plugin-a', user_id: 'u-1' });
    jinyBeh = await token({ kind: 'broker', source_ref: 'plugin-a', user_id: 'u-1' });
    process.env.BROKER_URL = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    process.env.BROKER_TOKEN = behPluginu;
    const m = (await import(/* @vite-ignore */ SHIM_BROKER)) as {
      createSandboxContext: (l: unknown[], i: unknown, d: unknown[]) => ShimCtx;
    };
    shim = m.createSandboxContext([], { plugin: { version: '1' }, tenant: { id: 't' }, config: {} }, []);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((ok) => dbServer.close(() => ok()));
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vycisti();
    db.politika = {
      schvaleno: true,
      source_slug: 'zdroj-a',
      network_allowlist: ['93.184.216.34', '127.0.0.1'],
      rpc_allowlist: ['wd_upsert_drivers_audited', 'audience_sync_source_catalog'],
    };
    db.porucha.clear();
    db.volani.length = 0;
    upstream.mockReset();
    vencovni.length = 0;
    logRadky.length = 0;
  });

  const volat = (cesta: string, payload: unknown, tok: string | null = behPluginu) =>
    app.inject({
      method: 'POST',
      url: `/sandbox/${cesta}`,
      headers: tok === null ? {} : { authorization: `Bearer ${tok}` },
      payload: payload as Record<string, unknown>,
    });

  interface Pripad {
    nazev: string;
    duvod: string;
    stav: number;
    druh: string;
    priprav?: () => void;
    zavolej: () => ReturnType<typeof volat>;
    /** Co smí v řádku logu být navíc (host u fetch, fn u rpc). */
    log?: Record<string, unknown>;
  }

  const PRIPADY: Pripad[] = [
    { nazev: 'chybí Authorization', duvod: 'token_neplatny', stav: 401, druh: 'kv/get', zavolej: () => volat('kv/get', { key: 'k' }, null) },
    { nazev: 'neplatný token', duvod: 'token_neplatny', stav: 401, druh: 'fetch', zavolej: () => volat('fetch', { url: `${DODAVATEL}/x` }, 'neplatny') },
    { nazev: 'rpc bez fn', duvod: 'pozadavek_neplatny', stav: 400, druh: 'rpc', zavolej: () => volat('rpc', { params: {} }) },
    { nazev: 'kv/get bez key', duvod: 'pozadavek_neplatny', stav: 400, druh: 'kv/get', zavolej: () => volat('kv/get', {}) },
    { nazev: 'kv/set bez key', duvod: 'pozadavek_neplatny', stav: 400, druh: 'kv/set', zavolej: () => volat('kv/set', { value: 1 }) },
    { nazev: 'kv/delete bez key', duvod: 'pozadavek_neplatny', stav: 400, druh: 'kv/delete', zavolej: () => volat('kv/delete', {}) },
    { nazev: 'fetch bez url', duvod: 'pozadavek_neplatny', stav: 400, druh: 'fetch', zavolej: () => volat('fetch', {}) },
    {
      nazev: 'fetch s neznámým redirect', duvod: 'pozadavek_neplatny', stav: 400, druh: 'fetch',
      zavolej: () => volat('fetch', { url: `${DODAVATEL}/x`, redirect: 'skok' }), log: { host: '93.184.216.34' },
    },
    { nazev: 'llm bez prompt', duvod: 'pozadavek_neplatny', stav: 400, druh: 'llm', zavolej: () => volat('llm', {}) },
    { nazev: 'notify bez title', duvod: 'pozadavek_neplatny', stav: 400, druh: 'notify', zavolej: () => volat('notify', {}) },
    { nazev: 'config pro jiný druh běhu', duvod: 'druh_behu_nepovoleny', stav: 403, druh: 'config', zavolej: () => volat('config', {}, jinyBeh) },
    {
      nazev: 'config nejde složit', duvod: 'konfigurace_necitelna', stav: 503, druh: 'config',
      priprav: () => db.porucha.add('get_plugin_runtime_config'), zavolej: () => volat('config', {}),
      log: { stav_db: 500, chyba_typ: 'PostgRESTError' },
    },
    {
      nazev: 'politika nečitelná (rpc)', duvod: 'politika_necitelna', stav: 503, druh: 'rpc',
      priprav: () => db.porucha.add('get_plugin_sandbox_policy'),
      zavolej: () => volat('rpc', { fn: 'wd_upsert_drivers_audited', params: {} }),
      log: { fn: 'wd_upsert_drivers_audited', stav_db: 500, chyba_typ: 'PostgRESTError' },
    },
    {
      nazev: 'politika nečitelná (fetch)', duvod: 'politika_necitelna', stav: 503, druh: 'fetch',
      priprav: () => db.porucha.add('get_plugin_sandbox_policy'),
      zavolej: () => volat('fetch', { url: `${DODAVATEL}/x` }), log: { host: '93.184.216.34', stav_db: 500 },
    },
    {
      nazev: 'RPC mimo politiku', duvod: 'fn_mimo_politiku', stav: 403, druh: 'rpc',
      zavolej: () => volat('rpc', { fn: 'admin_set_user_role', params: { p_role: 'TAJNY_PARAMETR' } }), log: { fn: 'admin_set_user_role' },
    },
    {
      nazev: 'RPC mimo whitelist služby (jiný druh běhu)', duvod: 'fn_mimo_whitelist', stav: 403, druh: 'rpc',
      zavolej: () => volat('rpc', { fn: 'jina_fn', params: { p: 'TAJNY_PARAMETR' } }, jinyBeh), log: { fn: 'jina_fn' },
    },
    {
      nazev: 'zápis pod cizím zdrojem', duvod: 'zdroj_cizi', stav: 403, druh: 'rpc',
      zavolej: () => volat('rpc', { fn: 'audience_sync_source_catalog', params: { p_source_slug: 'zdroj-b', p_rows: ['TAJNY_PARAMETR'] } }),
      log: { fn: 'audience_sync_source_catalog', parametr: 'p_source_slug' },
    },
    {
      // Druhá větev téže kontroly (ciziZdroj, 1a): běh, který pluginem není, pod jménem zdroje nezapíše.
      nazev: 'zápis pod zdrojem z běhu, který není plugin', duvod: 'zdroj_cizi', stav: 403, druh: 'rpc',
      zavolej: () => volat('rpc', { fn: 'povolena_fn', params: { p_events: [{ source: 'TAJNY_PARAMETR' }] } }, jinyBeh),
      log: { fn: 'povolena_fn', parametr: 'p_events[0].source' },
    },
    {
      nazev: 'povolené RPC selhalo v DB', duvod: 'rpc_selhalo', stav: 403, druh: 'rpc',
      priprav: () => db.porucha.add('wd_upsert_drivers_audited'),
      zavolej: () => volat('rpc', { fn: 'wd_upsert_drivers_audited', params: { p_rows: ['TAJNY_PARAMETR'] } }),
      log: { fn: 'wd_upsert_drivers_audited', stav_db: 500, chyba_typ: 'PostgRESTError' },
    },
    {
      nazev: 'RPC z whitelistu selhalo v DB (jiný druh běhu)', duvod: 'rpc_selhalo', stav: 403, druh: 'rpc',
      priprav: () => db.porucha.add('povolena_fn'),
      zavolej: () => volat('rpc', { fn: 'povolena_fn', params: {} }, jinyBeh), log: { fn: 'povolena_fn', stav_db: 500, chyba_typ: 'PostgRESTError' },
    },
    {
      nazev: 'žádný povolený cíl', duvod: 'zadny_povoleny_cil', stav: 403, druh: 'fetch',
      priprav: () => { db.politika = { ...db.politika, network_allowlist: [] }; },
      zavolej: () => volat('fetch', { url: `${DODAVATEL}/x` }), log: { host: '93.184.216.34' },
    },
    { nazev: 'URL nejde rozebrat', duvod: 'url_neplatna', stav: 403, druh: 'fetch', zavolej: () => volat('fetch', { url: 'neni url' }), log: { host: null } },
    {
      nazev: 'schéma http', duvod: 'schema_zakazane', stav: 403, druh: 'fetch',
      zavolej: () => volat('fetch', { url: 'http://93.184.216.34/x' }), log: { host: '93.184.216.34' },
    },
    {
      nazev: 'hostitel mimo allowlist', duvod: 'cil_mimo_allowlist', stav: 403, druh: 'fetch',
      zavolej: () => volat('fetch', { url: 'https://host/cesta?token=TAJNE' }), log: { host: 'host' },
    },
    {
      nazev: 'cíl se rozřeší na zakázanou IP', duvod: 'ip_blokovana', stav: 403, druh: 'fetch',
      zavolej: () => volat('fetch', { url: 'https://127.0.0.1/x' }), log: { host: '127.0.0.1' },
    },
    {
      nazev: "přesměrování při redirect: 'error'", duvod: 'presmerovani_odmitnuto', stav: 403, druh: 'fetch',
      priprav: () => upstream.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: `${DODAVATEL}/jinam?token=TAJNE` } })),
      zavolej: () => volat('fetch', { url: `${DODAVATEL}/x`, redirect: 'error' }), log: { host: '93.184.216.34' },
    },
  ];

  it('výčet důvodů = praxe: každý kód má svou větev v PRIPADY a nic navíc', () => {
    expect(Object.keys(DUVODY).sort()).toEqual([...new Set(PRIPADY.map((p) => p.duvod))].sort());
    for (const p of PRIPADY) expect(DUVODY[p.duvod], p.duvod).toBe(p.stav);
  });

  it.each(PRIPADY)('$nazev → $stav { duvod: $duvod } + jeden řádek v logu', async (p) => {
    p.priprav?.();
    const res = await p.zavolej();
    expect(res.statusCode).toBe(p.stav);
    const telo = res.json() as Record<string, unknown>;
    expect(telo.duvod).toBe(p.duvod);
    expect(typeof telo.error).toBe('string');
    // duvod je v těle první — shim dává do výjimky jen prvních 200 znaků těla.
    expect(res.body.startsWith(`{"duvod":"${p.duvod}"`)).toBe(true);

    const radky = odmitnutiVLogu();
    expect(radky).toHaveLength(1);
    expect(radky[0]).toMatchObject({
      druh: p.druh,
      duvod: p.duvod,
      plugin: p.duvod === 'token_neplatny' ? null : 'plugin-a',
      beh: p.duvod === 'token_neplatny' ? null : 'run-7',
      ...(p.log ?? {}),
    });
    // Žádné hodnoty parametrů, žádná cesta ani query cílové URL — nikde v logu služby.
    const cely = logRadky.join('\n');
    for (const tajne of ['TAJNE', 'TAJNY_PARAMETR', 'TAJNA_HODNOTA_PARAMETRU', '/cesta', 'token=']) {
      expect(cely).not.toContain(tajne);
    }
  });

  it.each(['config', 'rpc', 'kv/get', 'kv/set', 'kv/delete', 'fetch', 'llm', 'notify'])(
    'neplatný token na /sandbox/%s: 401 a trasa SKONČÍ — žádné volání DB, dodavatele, pushe ani LLM',
    async (cesta) => {
      const res = await volat(cesta, { key: 'k', value: 1, fn: 'povolena_fn', url: `${DODAVATEL}/x`, prompt: 'p', title: 't' }, 'neplatny');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ duvod: 'token_neplatny', error: 'Invalid broker token' });
      // Kdyby trasa po 401 běžela dál, volání ven by přišlo až po odpovědi — chvíli počkat.
      await new Promise((r) => setTimeout(r, 50));
      expect(db.volani).toEqual([]);
      expect(upstream).not.toHaveBeenCalled();
      expect(vencovni).toEqual([]);
      expect(odmitnutiVLogu()).toHaveLength(1);
    },
  );

  it('shim předá pluginu důvod v textu výjimky i u dlouhé chyby PostgRESTu (tělo se ořezává na 200 znaků)', async () => {
    db.porucha.add('wd_upsert_drivers_audited');
    await expect(shim.rpc('wd_upsert_drivers_audited', { p_rows: [] })).rejects.toThrow(/Broker rpc error 403: \{"duvod":"rpc_selhalo"/);
    await expect(shim.fetch('https://host/cesta?token=TAJNE')).rejects.toThrow(/Broker fetch error 403: \{"duvod":"cil_mimo_allowlist"/);
  });
});
