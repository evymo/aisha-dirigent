/**
 * Běh pluginu smí volat jen hostitele a RPC ze SVÉ schválené sandbox politiky.
 *
 * ⛔ NAMĚŘENO 2026-09-26 (produkce instance): broker bral seznamy jen z proměnných
 * služby `PLUGIN_NETWORK_ALLOWLIST` / `PLUGIN_RPC_WHITELIST` a ty byly prázdné —
 * schválený plugin by na prvním volání dodavatele i prvním zápisu dostal 403.
 *
 * Měří se skutečný broker (Fastify inject) nad skutečným @aisha/security;
 * mockuje se DB (rpcService) a globální fetch (dodavatel). Hostitelé jsou IP
 * literály, takže DNS lookup nejde do sítě.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const BROKER_SECRET = 'test-broker-secret-at-least-32-chars-long!!';
process.env.BROKER_TOKEN_SECRET = BROKER_SECRET;
// Proměnné služby záměrně PRÁZDNÉ — přesně stav v produkci.
process.env.PLUGIN_NETWORK_ALLOWLIST = '';
process.env.PLUGIN_RPC_WHITELIST = '';

const POVOLENY = 'https://93.184.216.34';
const CIZI = 'https://93.184.216.35';

const h = vi.hoisted(() => ({ rpc: vi.fn(), sandboxed: vi.fn() }));
vi.mock('../postgrest.js', () => ({ rpcService: h.rpc, rpcSandboxed: h.sandboxed }));

const upstream = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

async function token(claims: Record<string, unknown>): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('run-1')
    .setAudience('aisha-plugin-broker')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(BROKER_SECRET));
}

const politika = (p: Record<string, unknown>) =>
  h.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'get_plugin_sandbox_policy') return p;
    return { zapsano: 1 };
  });

describe('broker: běh pluginu volá jen to, co schválila jeho sandbox politika', () => {
  let app: import('fastify').FastifyInstance;
  let behPluginu: string;
  let vycisti: () => void;

  beforeAll(async () => {
    vi.stubGlobal('fetch', upstream);
    const Fastify = (await import('fastify')).default;
    const { sandboxBrokerRoutes } = await import('../routes/broker.js');
    ({ vyprazdnitMezipamet: vycisti } = await import('../sandbox-politika.js'));
    app = Fastify();
    await app.register(sandboxBrokerRoutes);
    await app.ready();
    behPluginu = await token({ kind: 'plugin-exec', source_ref: 'plugin-a', user_id: 'u' });
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vycisti();
    h.rpc.mockReset();
    h.sandboxed.mockReset();
    upstream.mockReset();
  });

  const fetchJako = (tok: string, url: string) =>
    app.inject({ method: 'POST', url: '/sandbox/fetch', headers: { authorization: `Bearer ${tok}` }, payload: { url } });
  const rpcJako = (tok: string, fn: string) =>
    app.inject({ method: 'POST', url: '/sandbox/rpc', headers: { authorization: `Bearer ${tok}` }, payload: { fn, params: { p: 1 } } });

  it('schválený plugin dosáhne na hostitele ze své politiky, i když je proměnná služby prázdná', async () => {
    politika({ schvaleno: true, network_allowlist: ['93.184.216.34'], rpc_allowlist: [] });
    upstream.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchJako(behPluginu, `${POVOLENY}/api`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 200, body: 'ok' });
    expect(h.rpc).toHaveBeenCalledWith('get_plugin_sandbox_policy', { p_plugin_slug: 'plugin-a' });
  });

  it('hostitel mimo politiku je odmítnut (403) a nic neodejde', async () => {
    politika({ schvaleno: true, network_allowlist: ['93.184.216.34'], rpc_allowlist: [] });
    const res = await fetchJako(behPluginu, `${CIZI}/api`);
    expect(res.statusCode).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('neschválený plugin (prázdné seznamy) nesmí ven vůbec', async () => {
    politika({ schvaleno: false, network_allowlist: [], rpc_allowlist: [] });
    const res = await fetchJako(behPluginu, `${POVOLENY}/api`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/No network destinations/);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('RPC ze schválené politiky projde (servisní rolí), jiné RPC je 403 a nezavolá se', async () => {
    politika({ schvaleno: true, network_allowlist: [], rpc_allowlist: ['wd_upsert_drivers_audited'] });
    const ok = await rpcJako(behPluginu, 'wd_upsert_drivers_audited');
    expect(ok.statusCode).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith('wd_upsert_drivers_audited', { p: 1 });

    const zakazane = await rpcJako(behPluginu, 'admin_set_user_role');
    expect(zakazane.statusCode).toBe(403);
    expect(zakazane.json().error).toMatch(/not in its approved sandbox policy/);
    expect(h.rpc).not.toHaveBeenCalledWith('admin_set_user_role', expect.anything());
    expect(h.sandboxed).not.toHaveBeenCalled();
  });

  it('politiku nejde přečíst → 503, ne povolení ani tichý zákaz', async () => {
    h.rpc.mockRejectedValue(new Error('db down'));
    expect((await fetchJako(behPluginu, `${POVOLENY}/api`)).statusCode).toBe(503);
    expect((await rpcJako(behPluginu, 'wd_upsert_drivers_audited')).statusCode).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('zápis do obecné dráhy jen pod VLASTNÍM zdrojem — cizí p_source_slug je 403 a nezavolá se', async () => {
    politika({ schvaleno: true, source_slug: 'zdroj-a', network_allowlist: [], rpc_allowlist: ['audience_sync_source_catalog'] });
    const zapis = (zdroj: string) =>
      app.inject({
        method: 'POST', url: '/sandbox/rpc', headers: { authorization: `Bearer ${behPluginu}` },
        payload: { fn: 'audience_sync_source_catalog', params: { p_source_slug: zdroj, p_kind: 'k', p_mode: 'series', p_rows: [] } },
      });
    expect((await zapis('zdroj-a')).statusCode).toBe(200);
    const cizi = await zapis('zdroj-b');
    expect(cizi.statusCode).toBe(403);
    expect(cizi.json().error).toMatch(/only write under its own source/);
    expect(h.rpc.mock.calls.filter(([fn]) => fn === 'audience_sync_source_catalog')).toHaveLength(1);
  });

  it('jiný druh běhu než plugin-exec dál používá proměnnou služby (prázdná = nic)', async () => {
    const jiny = await token({ kind: 'broker', source_ref: 'plugin-a', user_id: 'u' });
    const res = await fetchJako(jiny, `${POVOLENY}/api`);
    expect(res.statusCode).toBe(403);
    expect(h.rpc).not.toHaveBeenCalledWith('get_plugin_sandbox_policy', expect.anything());
  });
});

describe('sandbox-politika: zúžení instancí a mezipaměť', () => {
  it('proměnná instance seznam jen zužuje (průnik), prázdná nic nemění', async () => {
    const { zuzit } = await import('../sandbox-politika.js');
    expect(zuzit(['a', 'b'], [])).toEqual(['a', 'b']);
    expect(zuzit(['a', 'b'], ['b', 'c'])).toEqual(['b']);
  });

  it('politika se čte nejvýš jednou za minutu; po lhůtě znovu (odvolání se projeví)', async () => {
    const { politikaPluginu, vyprazdnitMezipamet } = await import('../sandbox-politika.js');
    vyprazdnitMezipamet();
    let ted = 1_000_000;
    const rpc = vi.fn(async () => ({ schvaleno: true, network_allowlist: ['h'], rpc_allowlist: ['f', 7] }));
    const deps = { rpc, ted: () => ted, instanceHosty: [], instanceRpc: [] };
    const prvni = await politikaPluginu('p', deps);
    expect(prvni).toEqual({ schvaleno: true, zdroj: null, hosty: ['h'], rpc: ['f'] });
    ted += 59_000;
    await politikaPluginu('p', deps);
    expect(rpc).toHaveBeenCalledTimes(1);
    ted += 2_000;
    await politikaPluginu('p', deps);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
