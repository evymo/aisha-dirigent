/**
 * /sandbox/config — konfigurace (i s pověřeními) se vydá jen běhu plugin-exec,
 * pro plugin a tenanta Z TOKENU, nikdy z těla požadavku.
 *
 * ⛔ NAMĚŘENO 2026-09-16: plugin dostával `ctx.config = {}` a konfigurace jela v ENV
 * kontejneru (PLUGIN_PAYLOAD), kam pověření nesmí. Test také hlídá, že payload do
 * runneru `config` už nenese.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const BROKER_SECRET = 'test-broker-secret-at-least-32-chars-long!!';
process.env.BROKER_TOKEN_SECRET = BROKER_SECRET;

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../postgrest.js', () => ({ rpcService: h.rpc, rpcSandboxed: vi.fn() }));

const TENANT = '88888888-8888-4888-8888-888888888888';

async function token(claims: Record<string, unknown>): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('run-1')
    .setAudience('aisha-plugin-broker')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(BROKER_SECRET));
}

describe('/sandbox/config', () => {
  let app: import('fastify').FastifyInstance;
  beforeAll(async () => {
    const Fastify = (await import('fastify')).default;
    const { sandboxBrokerRoutes } = await import('../routes/broker.js');
    app = Fastify();
    await app.register(sandboxBrokerRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ endpoint: 'https://zdroj.example.test', apiKey: 'tajne' });
  });

  it('běh plugin-exec dostane konfiguraci svého pluginu a tenanta — z tokenu, ne z těla', async () => {
    const t = await token({ kind: 'plugin-exec', source_ref: 'plugin-z-tokenu', user_id: 'u', tenant_id: TENANT });
    const res = await app.inject({
      method: 'POST',
      url: '/sandbox/config',
      headers: { authorization: `Bearer ${t}` },
      payload: { plugin_slug: 'cizi-plugin', tenant_id: '99999999-9999-4999-8999-999999999999' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ endpoint: 'https://zdroj.example.test', apiKey: 'tajne' });
    expect(h.rpc).toHaveBeenCalledWith('get_plugin_runtime_config', { p_plugin_slug: 'plugin-z-tokenu', p_tenant_id: TENANT });
  });

  it('⛔ token jiného druhu běhu konfiguraci nedostane', async () => {
    const t = await token({ kind: 'claude_cli_task', source_ref: 'repo', user_id: 'poller', tenant_id: '' });
    const res = await app.inject({ method: 'POST', url: '/sandbox/config', headers: { authorization: `Bearer ${t}` }, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('⛔ bez platného tokenu 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/sandbox/config', headers: { authorization: 'Bearer nesmysl' }, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe('payload do runneru nenese konfiguraci', () => {
  it('⛔ PLUGIN_PAYLOAD (ENV kontejneru) nemá klíč config', async () => {
    const zachyceno: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      zachyceno.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ run_id: 'r', status: 'succeeded', exit_code: 0, result: null, logs: [], duration_ms: 1 }), { status: 200 });
    }));
    const { runPluginInSandbox } = await import('../runner-client.js');
    await runPluginInSandbox({
      pluginSlug: 'p', action: 'cron.x', params: {}, image: 'i', codeB64: '', codeSha256: 's',
      userId: 'u', timeoutMs: 1000, serviceToken: 't', pluginVersion: '1', tenantId: TENANT,
    });
    vi.unstubAllGlobals();
    const payload = zachyceno[0]?.payload as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(Object.keys(payload)).not.toContain('config');
    expect(payload.tenant_id).toBe(TENANT);
  });
});
