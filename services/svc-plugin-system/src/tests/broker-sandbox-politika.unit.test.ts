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
// Řízený LLM router bez servisního tokenu odmítne (503) — test /sandbox/llm ho potřebuje.
process.env.POSTGREST_SERVICE_TOKEN = 'service-token';

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

  describe('zdroj pluginu jako TŘÍDA: každý argument, který jmenuje zdroj, patří zdroji pluginu', () => {
    const ZDROJ = 'eurowag-telematics';
    const RPC = ['twin_upsert_entity_audited', 'twin_record_events_audited', 'twin_identity_propose_match', 'audience_sync_source_catalog'];
    const volej = (fn: string, params: Record<string, unknown>, tok = behPluginu) =>
      app.inject({ method: 'POST', url: '/sandbox/rpc', headers: { authorization: `Bearer ${tok}` }, payload: { fn, params } });
    const zavolano = (fn: string) => h.rpc.mock.calls.filter(([f]) => f === fn).length;
    const udalost = (source: string, ref: string) => ({ source, source_ref: ref, event_type: 'vehicle_state', occurred_at: '2026-09-29T08:00:00Z' });

    beforeEach(() => politika({ schvaleno: true, source_slug: ZDROJ, network_allowlist: [], rpc_allowlist: RPC }));

    it('kladná kotva: skutečné tvary volání pod vlastním zdrojem i podzdroji `<zdroj>:<něco>` projdou', async () => {
      // eurowag-telematics: entita pod slugem, události pod podzdroji (twin-events.ts)
      expect((await volej('twin_upsert_entity_audited', { p_entity_type: 'vehicle', p_source: ZDROJ, p_source_key: 'VIN1', p_label: 'x' })).statusCode).toBe(200);
      expect((await volej('twin_record_events_audited', { p_events: [udalost(`${ZDROJ}:vehicle-state`, 'a'), udalost(`${ZDROJ}:trip`, 'b')] })).statusCode).toBe(200);
      expect(zavolano('twin_upsert_entity_audited')).toBe(1);
      expect(zavolano('twin_record_events_audited')).toBe(1);
    });

    it.each([
      ['p_source (dráha dvojčat)', 'twin_upsert_entity_audited', { p_entity_type: 'vehicle', p_source: 'webdispecink-fleet', p_source_key: 'VIN1' }, 'p_source'],
      ['p_to_source (párování)', 'twin_identity_propose_match', { p_twin_id: 't', p_to_source: 'jiny-zdroj', p_source_key: 'k' }, 'p_to_source'],
      ['p_source_slug (katalog)', 'audience_sync_source_catalog', { p_source_slug: 'jiny', p_kind: 'k', p_mode: 'series', p_rows: [] }, 'p_source_slug'],
      ['položka pole (události)', 'twin_record_events_audited', { p_events: [udalost(`${ZDROJ}:trip`, 'a'), udalost('webdispecink-fleet', 'b')] }, 'p_events[1].source'],
      ['past předpony (zdroj-ab ≠ zdroj-a:…)', 'twin_upsert_entity_audited', { p_source: `${ZDROJ}-evil`, p_source_key: 'k' }, 'p_source'],
      ['prázdný podzdroj', 'twin_upsert_entity_audited', { p_source: `${ZDROJ}:`, p_source_key: 'k' }, 'p_source'],
      ['podzdroj s další `:` (dvojí výklad)', 'twin_record_events_audited', { p_events: [udalost(`${ZDROJ}:trip:x`, 'a')] }, 'p_events[0].source'],
      ['ne-řetězec', 'twin_upsert_entity_audited', { p_source: null, p_source_key: 'k' }, 'p_source'],
      ['source_slug v objektu parametru', 'audience_sync_source_catalog', { p_source_slug: ZDROJ, p_meta: { source_slug: 'jiny' } }, 'p_meta.source_slug'],
    ])('cizí zdroj — %s → 403 s cestou a RPC se nezavolá', async (_, fn, params, cesta) => {
      const res = await volej(fn, params);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain(`(${cesta})`);
      expect(zavolano(fn)).toBe(0);
    });

    it('klíč UVNITŘ zdroje (p_source_key, p_source_ref) ani data dodavatele hlouběji zdroj nejmenují', async () => {
      const res = await volej('audience_sync_source_catalog', {
        p_source_slug: ZDROJ, p_kind: 'k', p_mode: 'series', p_source_ref: 'cokoli',
        p_rows: [{ external_id: 'e', fields: { source: 'web', lead_source: 'google' } }],
      });
      expect(res.statusCode).toBe(200);
    });

    it('plugin BEZ zdroje nesmí argument se zdrojem poslat vůbec; bez něj projde (kotva)', async () => {
      politika({ schvaleno: true, source_slug: null, network_allowlist: [], rpc_allowlist: ['twin_upsert_entity_audited', 'wd_upsert_drivers_audited'] });
      const res = await volej('twin_upsert_entity_audited', { p_source: 'cokoli', p_source_key: 'k' });
      expect(res.statusCode).toBe(403);
      expect(zavolano('twin_upsert_entity_audited')).toBe(0);
      expect((await volej('wd_upsert_drivers_audited', { p_drivers: [{ id: 1 }] })).statusCode).toBe(200);
    });

    it('běh, který není plugin (bez zdroje): argument se zdrojem → 403 dřív, než dojde na proměnnou služby', async () => {
      const jiny = await token({ kind: 'claude_cli_task', source_ref: '', user_id: 'u' });
      const res = await volej('twin_upsert_entity_audited', { p_source: ZDROJ, p_source_key: 'k' }, jiny);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/has no source/);
      expect(h.sandboxed).not.toHaveBeenCalled();
      // kotva: bez argumentu se zdrojem jde běh dál na proměnnou služby jako dřív
      h.sandboxed.mockResolvedValueOnce({ ok: true });
      expect((await volej('wd_upsert_drivers_audited', { p_drivers: [] }, jiny)).statusCode).toBe(200);
      expect(h.sandboxed).toHaveBeenCalledTimes(1);
    });
  });

  it('/sandbox/llm jde přes řízený generátor; plugin_slug bere z TOKENU běhu, ne z těla (dřív hlídal jen mrtvý kontext v procesu)', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'ok' }), { status: 200 }));
    const res = await app.inject({
      method: 'POST', url: '/sandbox/llm', headers: { authorization: `Bearer ${behPluginu}` },
      payload: { prompt: 'summarize this', model: 'gpt-4o-mini', maxTokens: 123, pluginSlug: 'cizi-plugin' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toBe('ok');
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toMatch(/ai-generate/);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer service-token');
    const telo = JSON.parse(String(init?.body));
    expect(telo.constraints).toMatchObject({ source: 'plugin_sandbox', plugin_slug: 'plugin-a', requested_model: 'gpt-4o-mini' });
    expect(telo.max_tokens).toBe(123);
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
