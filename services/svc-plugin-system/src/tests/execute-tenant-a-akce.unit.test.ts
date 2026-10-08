/**
 * /execute — tenant a akce se berou z OVĚŘENÉ identity a z MANIFESTU, ne z těla.
 *
 * ⛔ NAMĚŘENO 2026-09-16: `tenantId: body.tenant_id ?? ''` šlo rovnou do sandboxu
 * a plugin ho posílá do RPC, které broker volá se služební rolí (partner-metrics:
 * `p_partner_id: ctx.tenant.id`). `action` se proti manifestu nekontrolovala.
 * Volající tedy určoval, ČÍ data plugin čte a CO udělá.
 *
 * Test spouští skutečnou route přes Fastify inject; mockuje se jen hranice
 * (ověření tokenu, registr, artefakt, runner, PostgREST). Každé tvrzení jde
 * rozsvítit doČervena vrácením původního řádku v execute.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const UZIVATEL = '11111111-1111-4111-8111-111111111111';
const CIZI_TENANT = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({
  runner: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    agentRunnerEnabled: true,
    agentRunnerImage: 'test/plugin-exec:v1',
    pluginTimeoutMs: 1000,
    postgrestServiceToken: 'service-token-test',
  },
}));
vi.mock('../auth.js', () => ({
  verifyToken: vi.fn(async () => ({ userId: UZIVATEL, roles: ['admin'], claims: {} })),
}));
vi.mock('../sandbox.js', () => ({
  resolvePlugin: vi.fn(async () => ({
    id: '66666666-6666-4666-8666-666666666666',
    slug: 'plugin-pod-testem',
    version: '1.0.0',
    capabilities: ['cron.sync_rides', 'http.GET./status'],
    artifactUrl: 'http://artefakty.invalid/p.js',
    sha256: 'abc',
    status: 'ga',
    config: {},
  })),
  validateCapabilities: (caps: string[], req: string[]) => req.every((r) => caps.includes(r)),
  downloadAndVerifyArtifact: vi.fn(async () => 'module.exports = {}'),
}));
vi.mock('../runner-client.js', () => ({ runPluginInSandbox: h.runner }));
vi.mock('../postgrest.js', () => ({ rpcService: h.rpc }));

describe('/execute: tenant z identity, akce z manifestu', () => {
  let app: import('fastify').FastifyInstance;

  beforeAll(async () => {
    const Fastify = (await import('fastify')).default;
    const { pluginHostRoutes } = await import('../routes/execute.js');
    app = Fastify();
    await app.register(pluginHostRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    h.runner.mockReset();
    h.runner.mockResolvedValue({ status: 'succeeded', result: { ok: true }, logs: [] });
    h.rpc.mockReset();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'is_admin_or_staff' ? false : fn === 'plugin_capability_allowed' ? true : null));
  });

  const spust = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/execute', headers: { authorization: 'Bearer x' }, payload });

  it('bez tenant_id běží plugin za ověřeného uživatele — ne za prázdného tenanta', async () => {
    const res = await spust({ plugin_slug: 'plugin-pod-testem', action: 'cron.sync_rides' });
    expect(res.statusCode, res.body).toBe(200);
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.runner.mock.calls[0][0].tenantId).toBe(UZIVATEL);
  });

  it('⛔ cizí tenant_id od běžného uživatele se ODMÍTNE a plugin se nespustí', async () => {
    const res = await spust({ plugin_slug: 'plugin-pod-testem', action: 'cron.sync_rides', tenant_id: CIZI_TENANT });
    expect(res.statusCode).toBe(403);
    expect(h.runner).not.toHaveBeenCalled();
    // O admin/staff rozhoduje DB, ne realm role v JWT (mock tokenu nese roli admin).
    expect(h.rpc).toHaveBeenCalledWith('is_admin_or_staff', { p_user_id: UZIVATEL });
  });

  it('cizí tenant_id od admin/staff (podle DB) projde a runner dostane PRÁVĚ ho', async () => {
    h.rpc.mockImplementation(async (fn: string) => (fn === 'is_admin_or_staff' ? true : fn === 'plugin_capability_allowed' ? true : null));
    const res = await spust({ plugin_slug: 'plugin-pod-testem', action: 'cron.sync_rides', tenant_id: CIZI_TENANT });
    expect(res.statusCode, res.body).toBe(200);
    expect(h.runner.mock.calls[0][0].tenantId).toBe(CIZI_TENANT);
  });

  it('⛔ nedostupné ověření admin/staff = odmítnutí (fail-closed), ne spuštění', async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_admin_or_staff') throw new Error('PostgREST down');
      return fn === 'plugin_capability_allowed' ? true : null;
    });
    const res = await spust({ plugin_slug: 'plugin-pod-testem', action: 'cron.sync_rides', tenant_id: CIZI_TENANT });
    expect(res.statusCode).toBe(503);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('tenant_id, který není UUID, se odmítne', async () => {
    const res = await spust({ plugin_slug: 'plugin-pod-testem', action: 'cron.sync_rides', tenant_id: "x' OR 1=1" });
    expect(res.statusCode).toBe(400);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('⛔ akce, kterou manifest nedeklaruje, se odmítne — i když volající „požaduje" jen deklarované', async () => {
    const res = await spust({
      plugin_slug: 'plugin-pod-testem',
      action: 'http.POST./smazat-vse',
      required_capabilities: ['cron.sync_rides'],
    });
    expect(res.statusCode).toBe(403);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('⛔ chybějící akce se neodvozuje jako „default" — odmítne se', async () => {
    const res = await spust({ plugin_slug: 'plugin-pod-testem' });
    expect(res.statusCode).toBe(400);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('audit zapíše skutečného tenanta a to, zda šlo o běh jménem jiného', async () => {
    h.rpc.mockImplementation(async (fn: string) => (fn === 'is_admin_or_staff' ? true : fn === 'plugin_capability_allowed' ? true : null));
    await spust({ plugin_slug: 'plugin-pod-testem', action: 'http.GET./status', tenant_id: CIZI_TENANT });
    const audit = h.rpc.mock.calls.find(([fn]) => fn === 'write_audit_journal');
    expect(audit?.[1].p_details).toMatchObject({ tenant_id: CIZI_TENANT, jmenem_jineho_tenanta: true, action: 'http.GET./status' });
  });

  // 2026-09-24: manifest říká, co plugin UMÍ; zdroj dat, co SMÍ. Ruční běh nesmí
  // obejít rozhodnutí majitele (např. polohy), které plánovač už respektuje.
  it('⛔ schopnost, kterou zdroj nepovolil (nebo je vypnutý), se ruční cestou NESPUSTÍ', async () => {
    h.rpc.mockImplementation(async (fn: string) => (fn === 'plugin_capability_allowed' ? false : null));
    const res = await spust({ plugin_slug: 'plugin-pod-testem', action: 'cron.sync_rides' });
    expect(res.statusCode).toBe(403);
    expect(h.runner).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('plugin_capability_allowed', {
      p_capability: 'cron.sync_rides',
      p_plugin_id: '66666666-6666-4666-8666-666666666666',
    });
  });

  it('⛔ nedostupná kontrola povolení = odmítnutí (fail-closed), ne spuštění', async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'plugin_capability_allowed') throw new Error('PostgREST down');
      return null;
    });
    const res = await spust({ plugin_slug: 'plugin-pod-testem', action: 'cron.sync_rides' });
    expect(res.statusCode).toBe(503);
    expect(h.runner).not.toHaveBeenCalled();
  });
});
