/**
 * KV pluginu přes SKUTEČNÉ HTTP: shim (images/plugin-exec) → broker (fastify) →
 * falešný PostgREST na loopbacku.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (hlášení Tyreis, ověřeno čtením mainu ab87c8a7a):
 *   - plugin_kv_set / plugin_kv_delete jsou RETURNS void → PostgREST 204 bez těla;
 *     `rpcService` (strictRpc) volal `res.json()` → SyntaxError → trasa 500 →
 *     plugin dostal výjimku a kurzory se nikdy neuložily;
 *   - /sandbox/kv/get posílal JSON řetězec přes `reply.send(řetězec)` → fastify
 *     ho poslal jako text/plain bez uvozovek a shim ho `JSON.parse`-nul: "12345678"
 *     se vrátil jako číslo, "01234567" jako výjimka.
 *
 * PROČ ne mock `rpcService`: ostatní testy brokeru ho mockují, a proto tvar odpovědi
 * PostgRESTu (204 bez těla) ani tvar odpovědi brokeru (text/plain) nikdy neviděly.
 * Tady běží skutečný klient @aisha/postgrest-client, skutečný fastify na portu
 * a skutečný `brokerCall` shimu — mockuje se jen databáze (tvar odpovědí PostgRESTu
 * v14: void = 204 bez těla, jsonb = JSON hodnota s application/json).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Shim je jiný balíček (images/plugin-exec/shim). Cesta se SKLÁDÁ za běhu, aby ji
 * `tsc -p services/svc-plugin-system` nesledoval (rootDir ./src — statický import
 * by typovou kontrolu služby v CI shodil na TS6059). Typ kontextu je proto tady,
 * jen v rozsahu, který test používá.
 */
const SHIM_BROKER = fileURLToPath(new URL('../../../../images/plugin-exec/shim/src/broker.ts', import.meta.url));
interface ShimKv {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
}
interface ShimModul {
  createSandboxContext: (
    logs: unknown[],
    identity: { plugin: { version: string }; tenant: { id: string }; config: Record<string, unknown> },
    declared: unknown[],
  ) => { kv: ShimKv };
}

const BROKER_SECRET = 'test-broker-secret-at-least-32-chars-long!!';
process.env.BROKER_TOKEN_SECRET = BROKER_SECRET;
process.env.POSTGREST_SERVICE_TOKEN = 'service-token';
process.env.PLUGIN_NETWORK_ALLOWLIST = '';
process.env.PLUGIN_RPC_WHITELIST = '';

const PLUGIN = 'plugin-kv';

/** Falešný PostgREST: KV v paměti, odpovědi tvarem PostgRESTu; `porucha` = 500 na danou funkci. */
const db = {
  kv: new Map<string, unknown>(),
  volani: [] as Array<{ fn: string; telo: Record<string, unknown>; auth: string | undefined }>,
  porucha: new Set<string>(),
};

function odpovedPostgrest(req: IncomingMessage, res: ServerResponse): void {
  let surove = '';
  req.on('data', (c: Buffer) => { surove += c.toString('utf8'); });
  req.on('end', () => {
    const fn = (req.url ?? '').replace(/^\/rpc\//, '');
    const telo = (surove ? JSON.parse(surove) : {}) as Record<string, unknown>;
    db.volani.push({ fn, telo, auth: req.headers.authorization });
    if (db.porucha.has(fn)) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 'XX000', message: 'porucha databáze' }));
      return;
    }
    const klic = `${String(telo.p_plugin)}/${String(telo.p_key)}`;
    if (fn === 'plugin_kv_set' || fn === 'plugin_kv_delete') {
      if (fn === 'plugin_kv_set') db.kv.set(klic, telo.p_value);
      else db.kv.delete(klic);
      // RETURNS void: PostgREST v14 → 204 No Content, žádné tělo ani Content-Type.
      res.writeHead(204);
      res.end();
      return;
    }
    if (fn === 'plugin_kv_get') {
      // RETURNS jsonb: tělo je JSON hodnota; nepřítomný klíč = 'null'::jsonb.
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(db.kv.has(klic) ? db.kv.get(klic) : null));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 'PGRST202', message: `neznámá funkce ${fn}` }));
  });
}

async function poslouchat(server: Server): Promise<string> {
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function brokerToken(): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT({ kind: 'plugin-exec', source_ref: PLUGIN, user_id: 'u-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('run-kv-1')
    .setAudience('aisha-plugin-broker')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(BROKER_SECRET));
}

describe('KV pluginu: shim → broker → PostgREST přes skutečné HTTP', () => {
  const postgrest = createServer(odpovedPostgrest);
  let app: import('fastify').FastifyInstance;
  let brokerUrl: string;
  let token: string;
  let ctx: { kv: ShimKv };

  beforeAll(async () => {
    process.env.POSTGREST_URL = await poslouchat(postgrest);
    const Fastify = (await import('fastify')).default;
    const { sandboxBrokerRoutes } = await import('../routes/broker.js');
    app = Fastify();
    await app.register(sandboxBrokerRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    brokerUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    token = await brokerToken();
    // Shim čte BROKER_URL/BROKER_TOKEN při načtení modulu — proto až teď.
    process.env.BROKER_URL = brokerUrl;
    process.env.BROKER_TOKEN = token;
    process.env.RUN_ID = 'run-kv-1';
    const shim = (await import(/* @vite-ignore */ SHIM_BROKER)) as ShimModul;
    ctx = shim.createSandboxContext([], { plugin: { version: '1.0.0' }, tenant: { id: 't-1' }, config: {} }, []);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((ok) => postgrest.close(() => ok()));
  });

  beforeEach(() => {
    db.kv.clear();
    db.volani.length = 0;
    db.porucha.clear();
  });

  const primo = (cesta: string, payload: unknown) =>
    fetch(`${brokerUrl}/sandbox/${cesta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

  it('kv/set: PostgREST 204 bez těla → trasa 204, shim vrátí undefined, hodnota je uložená', async () => {
    const res = await primo('kv/set', { key: 'kurzor', value: { od: 5 } });
    expect(res.status).toBe(204);
    await expect(ctx.kv.set('kurzor', { od: 6 })).resolves.toBeUndefined();
    expect(db.kv.get(`${PLUGIN}/kurzor`)).toEqual({ od: 6 });
    // Plugin a tenant z TOKENU, servisní token do PostgRESTu.
    expect(db.volani.at(-1)).toEqual({
      fn: 'plugin_kv_set',
      telo: { p_key: 'kurzor', p_plugin: PLUGIN, p_value: { od: 6 } },
      auth: 'Bearer service-token',
    });
  });

  it('kv/delete: PostgREST 204 bez těla → trasa 204, klíč zmizí', async () => {
    db.kv.set(`${PLUGIN}/kurzor`, 'x');
    const res = await primo('kv/delete', { key: 'kurzor' });
    expect(res.status).toBe(204);
    db.kv.set(`${PLUGIN}/kurzor`, 'x');
    await expect(ctx.kv.delete('kurzor')).resolves.toBeUndefined();
    expect(db.kv.has(`${PLUGIN}/kurzor`)).toBe(false);
  });

  it.each(['12345678', '01234567', '', 'null', 'text s "uvozovkami"'])(
    'kv/get: uložený řetězec %j dorazí do pluginu PŘESNĚ jako tentýž řetězec',
    async (hodnota) => {
      // Hodnota rovnou v „DB" — měří se jen čtení (zápis má vlastní případy výš).
      db.kv.set(`${PLUGIN}/kurzor`, hodnota);
      const prectene = await ctx.kv.get('kurzor');
      expect(typeof prectene).toBe('string');
      expect(prectene).toBe(hodnota);
    },
  );

  it('kv/get: odpověď brokeru je vždy JSON (application/json), ne text/plain', async () => {
    db.kv.set(`${PLUGIN}/kurzor`, '12345678');
    const res = await primo('kv/get', { key: 'kurzor' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.text()).toBe('"12345678"');
  });

  it('kv/get: objekt, číslo a pole projdou beze změny', async () => {
    await ctx.kv.set('o', { kurzor: '01234567', strana: 2, hotovo: false });
    await ctx.kv.set('n', 42);
    await ctx.kv.set('a', [1, '2']);
    expect(await ctx.kv.get('o')).toEqual({ kurzor: '01234567', strana: 2, hotovo: false });
    expect(await ctx.kv.get('n')).toBe(42);
    expect(await ctx.kv.get('a')).toEqual([1, '2']);
  });

  it('kv/get: nepřítomný klíč → null (ne undefined, ne výjimka)', async () => {
    const res = await primo('kv/get', { key: 'nikdy' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('null');
    await expect(ctx.kv.get('nikdy')).resolves.toBeNull();
  });

  it('PostgREST 500 na kv/set → trasa chyba (ne tiché 204) a plugin dostane výjimku', async () => {
    db.porucha.add('plugin_kv_set');
    const res = await primo('kv/set', { key: 'kurzor', value: 1 });
    expect(res.status).not.toBe(204);
    expect(res.status).toBeGreaterThanOrEqual(500);
    await expect(ctx.kv.set('kurzor', 1)).rejects.toThrow(/Broker kv\/set error 5\d\d/);
    expect(db.kv.has(`${PLUGIN}/kurzor`)).toBe(false);
  });

  it('PostgREST 500 na kv/delete → trasa chyba, ne tiché 204', async () => {
    db.porucha.add('plugin_kv_delete');
    const res = await primo('kv/delete', { key: 'kurzor' });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
