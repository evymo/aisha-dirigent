/**
 * scheduler-routes-authz.test.ts — /sync/scheduler/{status,trigger} authz
 *
 * Regression guard for a CONFIRMED critical defect (2026-06-10): the scheduler
 * routes were inlined in server.ts with NO preHandler, so a live broker
 * returned HTTP 200 to an unauthenticated POST /sync/scheduler/trigger — the
 * same privileged source→aisha sync as the guarded /sync/run, completely
 * bypassing guard.requireAdminOrService and not even honoring
 * devAllowUnauthedSync.
 *
 * These tests boot a real Fastify app, register ONLY the scheduler routes via
 * registerSchedulerRoutes (the extracted, guarded module), and assert:
 *   • with devAllowUnauthedSync=false + no Authorization → 401 (both routes);
 *   • trigger never reaches the scheduler when unauthorized (no side effect);
 *   • with the dev bypass on, the routes are reachable (local/CI escape hatch).
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerSchedulerRoutes } from '../routes/scheduler.js';
import type { SourceBrokerConfig } from '../config.js';
import type { SchedulerHandle } from '../scheduler.js';

function baseConfig(overrides: Partial<SourceBrokerConfig> = {}): SourceBrokerConfig {
  return {
    postgrestUrl: 'http://postgrest',
    postgrestServiceToken: 't',
    postgresUrl: 'postgres://t',
    keycloakUrl: 'http://k',
    keycloakRealm: 'aisha',
    oidcAppClientId: 'aisha-app',
    sourceApiUrl: 'http://s',
    sourceServiceEmail: '',
    sourceServicePassword: '',
    sourcePgUrl: 'postgres://s',
    sourceAuthHandshakeOutgoing: 'RAM YAM KHAM OM A HUM',
    sourceAuthHandshakeIncoming: 'OM A HUM VAJRA GURU PADMA SIDDHI HUM',
    jwtCacheTtlMs: 3_600_000,
    webhookHmacSecret: 'secret',
    syncIntervalMs: 86_400_000,
    port: 8090,
    logLevel: 'silent',
    corsAllowlist: '',
    rateLimitEnabled: false,
    devAllowUnauthedSync: false,
    aishaGatewayUrl: 'http://gateway:3001',
    aishaGatewayIntranetKey: '',
    aishaJwtSecret: '',
    aishaJwtExpSec: 3600,
    aishaMemberRole: 'authenticated',
    ...overrides,
  };
}

/** A fake scheduler that records whether triggerNow was ever called. */
function fakeScheduler(): SchedulerHandle & { triggered: () => number } {
  let triggers = 0;
  return {
    start: async () => {},
    stop: () => {},
    triggerNow: async () => {
      triggers += 1;
      return { inserted: 0, updated: 0, skipped: 0, durationMs: 0 } as never;
    },
    lastResult: () => null,
    syncState: () => null,
    triggered: () => triggers,
  };
}

async function appWith(config: SourceBrokerConfig, scheduler: SchedulerHandle) {
  const app = Fastify({ logger: false });
  registerSchedulerRoutes(app, scheduler, config);
  await app.ready();
  return app;
}

describe('/sync/scheduler/* authorization', () => {
  it('POST /sync/scheduler/trigger → 401 without auth (default prod posture)', async () => {
    const sched = fakeScheduler();
    const app = await appWith(baseConfig(), sched);
    const res = await app.inject({ method: 'POST', url: '/sync/scheduler/trigger', payload: {} });
    expect(res.statusCode).toBe(401);
    // Critical: the privileged sync must NOT have run.
    expect(sched.triggered()).toBe(0);
    await app.close();
  });

  it('GET /sync/scheduler/status → 401 without auth (no state disclosure)', async () => {
    const app = await appWith(baseConfig(), fakeScheduler());
    const res = await app.inject({ method: 'GET', url: '/sync/scheduler/status' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a spoofable identity header (X-Aisha-User-Role: admin) → 401', async () => {
    const sched = fakeScheduler();
    const app = await appWith(baseConfig(), sched);
    const res = await app.inject({
      method: 'POST',
      url: '/sync/scheduler/trigger',
      headers: { 'x-aisha-user-role': 'admin' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(sched.triggered()).toBe(0);
    await app.close();
  });

  it('dev bypass (devAllowUnauthedSync=true) makes the routes reachable for local/CI', async () => {
    const sched = fakeScheduler();
    const app = await appWith(baseConfig({ devAllowUnauthedSync: true }), sched);
    const res = await app.inject({ method: 'POST', url: '/sync/scheduler/trigger', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(sched.triggered()).toBe(1);
    await app.close();
  });
});
