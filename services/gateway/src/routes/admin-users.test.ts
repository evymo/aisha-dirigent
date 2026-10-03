/**
 * Testy zakládání uživatelů z administrace.
 *
 * Hlídají se dvě hranice, protože obě mají tichou variantu selhání:
 *  1. AUTORIZACE — bez admin JWT se sem nesmí nikdo dostat. Tahle routa umí
 *     založit účet v Keycloaku, takže díra tady znamená cizí účet v realmu.
 *  2. NENAKONFIGUROVANÝ SERVISNÍ ÚČET — musí být hlasitá odpověď (503), ne
 *     tichý úspěch. Kdyby route vrátila 200 a e-mail neposlala, pozvaný by
 *     čekal na zprávu, která nikdy nepřijde, a administrace by tvrdila „hotovo".
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mockujeme NÁŠ šev (guarded-fetch), ne globální `fetch`. SSRF guard totiž
// před odesláním překládá jméno na IP, a `postgrest`/`keycloak` se v testovém
// prostředí nepřeloží — test by pak měřil DNS, ne chování routy.
const guardedFetch = vi.hoisted(() => vi.fn());
vi.mock('../lib/guarded-fetch.js', () => ({ guardedFetch, __resetGuard: () => {} }));

const { adminUsersRoute } = await import('./admin-users.js');
const { __resetKcAdminTokenCache } = await import('../auth/kc-admin.js');

const puvodniSecret = process.env.KC_ADMIN_CLIENT_SECRET;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(adminUsersRoute, { prefix: '/admin' });
  return app;
}

function invite(app: FastifyInstance, authorization?: string) {
  return app.inject({
    method: 'POST',
    url: '/admin/users/invite',
    headers: authorization ? { authorization } : undefined,
    payload: { email: 'novy@example.test', role: 'member' },
  });
}

beforeEach(() => {
  __resetKcAdminTokenCache();
  guardedFetch.mockReset();
});

afterEach(() => {
  if (puvodniSecret === undefined) delete process.env.KC_ADMIN_CLIENT_SECRET;
  else process.env.KC_ADMIN_CLIENT_SECRET = puvodniSecret;
});

describe('POST /admin/users/invite', () => {
  it('bez JWT odmítne 401 — a nesáhne na Keycloak', async () => {
    const app = await buildApp();
    const res = await invite(app);
    expect(res.statusCode).toBe(401);
    expect(guardedFetch, 'neautorizovaný požadavek nesmí volat vůbec nic').not.toHaveBeenCalled();
    await app.close();
  });

  it('s JWT bez admin role odmítne 403', async () => {
    // `is_admin_or_staff` vrátí false → route musí skončit dřív, než cokoli založí.
    guardedFetch.mockResolvedValue(new Response(JSON.stringify(false), { status: 200 }));
    const app = await buildApp();
    const res = await invite(app, 'Bearer nekdo-jiny');
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('bez servisního účtu hlásí 503, ne tichý úspěch', async () => {
    delete process.env.KC_ADMIN_CLIENT_SECRET;
    __resetKcAdminTokenCache();
    guardedFetch.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.includes('/rpc/is_admin_or_staff')) {
        return new Response(JSON.stringify(true), { status: 200 });
      }
      throw new Error(`neočekávané volání: ${url}`);
    });
    const app = await buildApp();
    const res = await invite(app, 'Bearer admin');
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/KC_ADMIN_CLIENT_SECRET/);
    await app.close();
  });

  it('opakovaná pozvánka existujícího účtu nezakládá druhý (idempotence)', async () => {
    process.env.KC_ADMIN_CLIENT_SECRET = 'tajne';
    __resetKcAdminTokenCache();
    const volani: string[] = [];
    guardedFetch.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      volani.push(`${method} ${url}`);
      if (url.includes('/rpc/is_admin_or_staff')) return new Response(JSON.stringify(true), { status: 200 });
      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'kc-token', expires_in: 60 }), { status: 200 });
      }
      if (url.includes('/users?email=')) {
        return new Response(JSON.stringify([{ id: 'uz-existuje' }]), { status: 200 });
      }
      if (url.includes('/rpc/create_invitation')) return new Response(JSON.stringify('inv-1'), { status: 200 });
      if (url.includes('/execute-actions-email')) return new Response(null, { status: 204 });
      throw new Error(`neočekávané volání: ${method} ${url}`);
    });

    const app = await buildApp();
    const res = await invite(app, 'Bearer admin');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: false, email_sent: true, user_id: 'uz-existuje' });
    expect(
      volani.some((v) => v.startsWith('POST') && /\/users$/.test(v)),
      'existující účet se nesmí zakládat znovu',
    ).toBe(false);
    await app.close();
  });

  it('když e-mail selže, vrací 207 — účet je založený, to není celkové selhání', async () => {
    process.env.KC_ADMIN_CLIENT_SECRET = 'tajne';
    __resetKcAdminTokenCache();
    guardedFetch.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.includes('/rpc/is_admin_or_staff')) return new Response(JSON.stringify(true), { status: 200 });
      if (url.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'kc-token', expires_in: 60 }), { status: 200 });
      }
      if (url.includes('/users?email=')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.endsWith('/users')) {
        return new Response(null, {
          status: 201,
          headers: { location: 'https://kc/admin/realms/aisha/users/novy-id' },
        });
      }
      if (url.includes('/rpc/create_invitation')) return new Response(JSON.stringify('inv-2'), { status: 200 });
      if (url.includes('/execute-actions-email')) return new Response('smtp down', { status: 500 });
      throw new Error(`neočekávané volání: ${url}`);
    });

    const app = await buildApp();
    const res = await invite(app, 'Bearer admin');
    expect(res.statusCode).toBe(207);
    expect(res.json()).toMatchObject({ created: true, email_sent: false, user_id: 'novy-id' });
    await app.close();
  });
});
