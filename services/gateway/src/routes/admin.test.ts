import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { adminRoutes } from './admin.js';

const originalServiceToken = process.env.POSTGREST_SERVICE_TOKEN;
const originalKcAdminSecret = process.env.KC_ADMIN_CLIENT_SECRET;
const serviceTokenFixture = 'svc-token-fixture';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(adminRoutes, { prefix: '/admin' });
  return app;
}

async function injectRoleSync(app: FastifyInstance, authorization?: string) {
  return app.inject({
    method: 'POST',
    url: '/admin/kc-role-sync',
    headers: authorization ? { authorization } : undefined,
    payload: {
      action: 'add',
      role: 'admin',
      user_id: 'user-123',
    },
  });
}

afterEach(() => {
  if (originalServiceToken === undefined) {
    delete process.env.POSTGREST_SERVICE_TOKEN;
  } else {
    process.env.POSTGREST_SERVICE_TOKEN = originalServiceToken;
  }

  if (originalKcAdminSecret === undefined) {
    delete process.env.KC_ADMIN_CLIENT_SECRET;
  } else {
    process.env.KC_ADMIN_CLIENT_SECRET = originalKcAdminSecret;
  }
});

describe('admin kc-role-sync service-role authentication', () => {
  it('fails closed when the service token is not configured', async () => {
    delete process.env.POSTGREST_SERVICE_TOKEN;
    const app = await buildApp();

    try {
      const response = await injectRoleSync(app, 'Bearer ');

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'Service-role required' });
    } finally {
      await app.close();
    }
  });

  it('rejects bearer tokens that merely contain the configured service token', async () => {
    process.env.POSTGREST_SERVICE_TOKEN = serviceTokenFixture;
    const app = await buildApp();

    try {
      const response = await injectRoleSync(app, `Bearer prefix-${serviceTokenFixture}-suffix`);

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Service-role required' });
    } finally {
      await app.close();
    }
  });

  it('allows an exact service token to reach the Keycloak role-sync handler', async () => {
    process.env.POSTGREST_SERVICE_TOKEN = serviceTokenFixture;
    delete process.env.KC_ADMIN_CLIENT_SECRET;
    const app = await buildApp();

    try {
      const response = await injectRoleSync(app, `Bearer ${serviceTokenFixture}`);

      // 503, ne 500: chybějící servisní účet je nenakonfigurovaná cesta, ne chyba
      // serveru — a je to týž tvar, jaký vrací /users/invite. Do 2026-08-02 sem
      // routa dojela vždycky, protože četla `KC_ADMIN_TOKEN`, kterou nikdo nikde
      // nenastavoval; endpoint tedy v nasazení NIKDY nefungoval.
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: 'KC admin service account not configured (KC_ADMIN_CLIENT_SECRET)',
      });
    } finally {
      await app.close();
    }
  });
});
