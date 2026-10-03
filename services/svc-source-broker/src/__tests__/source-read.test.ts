/**
 * source-read.test.ts — /source/:storyId/{kpi,engagement,member} route flow.
 *
 * These are the tests whose ABSENCE let a dispatch blocker ship: the routes are
 * exercised end-to-end (guard → resolve → dispatch BY STORY → cache → live read →
 * write-through → audit) against a real SourceRegistry with a fake adapter and an
 * injected fake DB seam. The keystone assertion is "an approved, registered source
 * returns 200 live data" — i.e. getForStory(storyId) actually reaches the fork's
 * adapter instead of falling through to NullDataSource (501).
 *
 * DB I/O is faked via SourceReadDeps; the guard is bypassed with
 * devAllowUnauthedSync so the tests target the route LOGIC, not auth (auth is
 * covered by scheduler-routes-authz.test.ts + the same guard).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { IDataSource, SourceConnection } from '@aisha/audience-types';
import { SourceRegistry } from '../adapters/source-registry.js';
import {
  registerSourceReadRoutes,
  type SourceReadDeps,
  type BindingResolution,
} from '../routes/source-read.js';
import type { SourceBrokerConfig } from '../config.js';

const STORY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function baseConfig(overrides: Partial<SourceBrokerConfig> = {}): SourceBrokerConfig {
  return {
    postgrestUrl: 'http://postgrest', postgrestServiceToken: 't', postgresUrl: 'postgres://t',
    keycloakUrl: 'http://k', keycloakRealm: 'aisha', oidcAppClientId: 'aisha-app', sourceApiUrl: 'http://s',
    sourceServiceEmail: '', sourceServicePassword: '', sourcePgUrl: 'postgres://s',
    sourceAuthHandshakeOutgoing: 'x', sourceAuthHandshakeIncoming: 'y', jwtCacheTtlMs: 3_600_000,
    webhookHmacSecret: 'secret', syncIntervalMs: 86_400_000, port: 8090, logLevel: 'silent',
    corsAllowlist: '', rateLimitEnabled: false, devAllowUnauthedSync: true,
    aishaGatewayUrl: 'http://gateway', aishaGatewayIntranetKey: '', aishaJwtSecret: '',
    aishaJwtExpSec: 3600, aishaMemberRole: 'authenticated', ...overrides,
  };
}

/** Fake adapter bound to a story; records the connection + can be told to throw. */
function fakeAdapter(opts: { storyId: string; throwOnRead?: boolean; noList?: boolean } ) {
  const seen: { connection?: SourceConnection; externalId?: string; listOpts?: unknown } = {};
  const ds = {
    config: { slug: 'tenant', displayName: 'Tenant', version: '1', capabilities: ['realtime-fdw'], authKind: 'pg_dsn', storyId: opts.storyId },
    async initialize() {},
    async *fetchAggregateSnapshots() {},
    async getEntity(_t: string, externalId: string, _c: unknown, connection?: SourceConnection) {
      seen.connection = connection; seen.externalId = externalId;
      if (opts.throwOnRead) throw new Error('source replica unreachable');
      return { entity: { userId: externalId, appAccesses30d: 7 }, callerScope: { userId: 'op', tier: 'admin', allowedReason: 't' } };
    },
    async listEntities(_t: string, connection: SourceConnection, listOpts?: unknown) {
      seen.connection = connection; seen.listOpts = listOpts;
      if (opts.throwOnRead) throw new Error('source replica unreachable');
      return [{ documentNumber: 'FV2026001', documentType: 'invoice' }];
    },
    async listStats(kind: string, connection: SourceConnection, statOpts?: unknown) {
      seen.connection = connection; seen.listOpts = statOpts;
      if (opts.throwOnRead) throw new Error('source replica unreachable');
      return [{ kind, month: (statOpts as { month: string }).month, externalId: 'x-1', title: 'T', followCount: 2, deleted: false }];
    },
    async probe() { return { status: 'healthy', checkedAt: new Date(0).toISOString() }; },
    async shutdown() {},
  } as unknown as IDataSource;
  // An engagement-only source (or the NullDataSource) has no listEntities / listStats.
  if (opts.noList) {
    delete (ds as { listEntities?: unknown }).listEntities;
    delete (ds as { listStats?: unknown }).listStats;
  }
  return { ds, seen };
}

/** Fake DB seam: canned resolution + recorded upsert/audit calls. */
function fakeDeps(resolution: BindingResolution | (() => Promise<BindingResolution>)) {
  const calls = { upserts: [] as Array<{ userId: string; snapshot: unknown; slug: string }>, audits: 0, resolves: 0 };
  const deps: SourceReadDeps = {
    async resolveBinding() {
      calls.resolves += 1;
      return typeof resolution === 'function' ? resolution() : resolution;
    },
    async upsertEngagement(userId, snapshot, slug) { calls.upserts.push({ userId, snapshot, slug }); },
    async auditRead() { calls.audits += 1; },
  };
  return { deps, calls };
}

const APPROVED: BindingResolution = {
  status: 'ok',
  binding: {
    instance_id: 'inst-1', endpoint_url: 'postgres://replica/crm', auth_method: 'pg_dsn',
    auth_secret_ref: 'secret-ref://pg', data_sensitivity: 'confidential', is_approved: true,
  },
};

async function build(registry: SourceRegistry, deps: SourceReadDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerSourceReadRoutes(app, registry, baseConfig(), deps);
  await app.ready();
  return app;
}

async function registryWithAdapter(ds: IDataSource): Promise<SourceRegistry> {
  const reg = new SourceRegistry();
  await reg.load();
  await reg.register(ds);
  return reg;
}

describe('/source/* — dispatch BY STORY reaches the registered adapter (blocker regression)', () => {
  let reg: SourceRegistry;
  let seen: { connection?: SourceConnection; externalId?: string };

  beforeEach(async () => {
    const fa = fakeAdapter({ storyId: STORY });
    seen = fa.seen;
    reg = await registryWithAdapter(fa.ds);
  });

  it('approved + registered → 200 live data (NOT 501); getForStory reached the adapter', async () => {
    const { deps } = fakeDeps(APPROVED);
    const app = await build(reg, deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', live: true, cached: false });
    expect(body.data.entity).toBeTruthy();
    await app.close();
  });

  it('hands the adapter the resolved SourceConnection (endpoint + credential ref)', async () => {
    const { deps } = fakeDeps(APPROVED);
    const app = await build(reg, deps);
    await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(seen.connection).toMatchObject({ endpointUrl: 'postgres://replica/crm', authSecretRef: 'secret-ref://pg', dataSensitivity: 'confidential' });
    await app.close();
  });

  it('engagement read writes through to the mirror in the RPC snake_case shape', async () => {
    const { deps, calls } = fakeDeps(APPROVED);
    const app = await build(reg, deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/engagement/${USER}` });
    expect(res.statusCode).toBe(200);
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]).toMatchObject({ userId: USER, slug: 'tenant' });
    // The snapshot MUST be snake_case: audience_upsert_user_engagement reads
    // p_data->>'app_accesses_30d'; a raw camelCase payload misses every key and
    // zeroes the user's row. Assert the mapping happened AND the camelCase leaked nothing.
    const snap = calls.upserts[0].snapshot as Record<string, unknown>;
    expect(snap.app_accesses_30d).toBe(7);
    expect(snap.appAccesses30d).toBeUndefined();
    await app.close();
  });

  it('KPI (community aggregate) does NOT write through — no single mirror row', async () => {
    const { deps, calls } = fakeDeps(APPROVED);
    const app = await build(reg, deps);
    await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(calls.upserts).toHaveLength(0);
    await app.close();
  });

  it('caches: a second read is served cached and does not hit the adapter again', async () => {
    const { deps } = fakeDeps(APPROVED);
    const app = await build(reg, deps);
    await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    const res2 = await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(res2.json()).toMatchObject({ cached: true, live: false });
    await app.close();
  });
});

describe('/source/* — governance + fail-loud + input validation', () => {
  it('unapproved source → 403 (the approve↔read tie)', async () => {
    const fa = fakeAdapter({ storyId: STORY });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps({ status: 'unapproved' }).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('source_not_approved');
    await app.close();
  });

  it('no active instance → 404 source_not_materialized (clean, not a pg 500)', async () => {
    const fa = fakeAdapter({ storyId: STORY });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps({ status: 'unmaterialized' }).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('source_not_materialized');
    await app.close();
  });

  it('approved story but NO adapter registered → 501 not_configured (OPTIONAL)', async () => {
    const reg = new SourceRegistry();
    await reg.load(); // no adapter registered → getForStory → NullDataSource
    const app = await build(reg, fakeDeps(APPROVED).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe('source_not_configured');
    await app.close();
  });

  it('configured-but-broken adapter → 502 fail-loud (never zeros)', async () => {
    const fa = fakeAdapter({ storyId: STORY, throwOnRead: true });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps(APPROVED).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('source_read_failure');
    await app.close();
  });

  it('a resolver infra failure → 502 fail-loud (no raw 500 leak)', async () => {
    const fa = fakeAdapter({ storyId: STORY });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps(() => Promise.reject(new Error('db down'))).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/kpi` });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it('a failed write-through still audits the read (audit fires before the throwing mirror write) and 502s', async () => {
    const fa = fakeAdapter({ storyId: STORY });
    const { deps, calls } = fakeDeps(APPROVED);
    deps.upsertEngagement = async () => { throw new Error('mirror deadlock'); };
    const app = await build(await registryWithAdapter(fa.ds), deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/engagement/${USER}` });
    expect(res.statusCode).toBe(502);
    expect(calls.audits).toBe(1); // the cross-user read that DID happen was audited
    await app.close();
  });

  it('non-UUID storyId → 400 invalid_story_id (not a pg cast 500)', async () => {
    const app = await build(new SourceRegistry(), fakeDeps(APPROVED).deps);
    const res = await app.inject({ method: 'GET', url: `/source/not-a-uuid/kpi` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_story_id');
    await app.close();
  });

  it('non-UUID userId on the engagement route → 400 invalid_user_id', async () => {
    const app = await build(new SourceRegistry(), fakeDeps(APPROVED).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/engagement/not-a-uuid` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_user_id');
    await app.close();
  });
});

describe('/source/:storyId/document(s) — the document entity (delivery notes, invoices)', () => {
  it('GET one document → 200 mapped entity; NO engagement write-through', async () => {
    const fa = fakeAdapter({ storyId: STORY });
    const { deps, calls } = fakeDeps(APPROVED);
    const app = await build(await registryWithAdapter(fa.ds), deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/document/FV2026001` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', live: true });
    expect(res.json().data.entity).toBeTruthy();
    expect(fa.seen.externalId).toBe('FV2026001'); // lookup-by-number path reached the adapter
    expect(calls.upserts).toHaveLength(0); // documents are NOT engagement mirror rows
    await app.close();
  });

  it('GET documents (batch) → 200 array via listEntities, with query opts passed through', async () => {
    const fa = fakeAdapter({ storyId: STORY });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps(APPROVED).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/documents?limit=10&since=2026-01-01` });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
    expect(res.json().data[0].documentNumber).toBe('FV2026001');
    expect(fa.seen.listOpts).toMatchObject({ limit: 10 });
    expect((fa.seen.listOpts as { since?: Date }).since instanceof Date).toBe(true);
    await app.close();
  });

  it('documents batch on a source without listEntities → 501 not_configured', async () => {
    const fa = fakeAdapter({ storyId: STORY, noList: true });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps(APPROVED).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/documents` });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe('source_not_configured');
    await app.close();
  });

  it('unapproved source → 403 on the document route too (same governance)', async () => {
    const fa = fakeAdapter({ storyId: STORY });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps({ status: 'unapproved' }).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/document/FV1` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('broken adapter → 502 fail-loud on documents batch (never a silent empty array)', async () => {
    const fa = fakeAdapter({ storyId: STORY, throwOnRead: true });
    const app = await build(await registryWithAdapter(fa.ds), fakeDeps(APPROVED).deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/documents` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('source_read_failure');
    await app.close();
  });
});


describe('/source/:storyId/stats/:kind — period statistics', () => {
  it('approved + adapter with listStats → 200 live rows, month + kind echoed, connection handed over', async () => {
    const { ds, seen } = fakeAdapter({ storyId: STORY });
    const { deps } = fakeDeps(APPROVED);
    const app = await build(await registryWithAdapter(ds), deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/stats/topic?month=2026-08&limit=50` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.live).toBe(true);
    expect(body.kind).toBe('topic');
    expect(body.month).toBe('2026-08');
    expect(body.data[0]).toMatchObject({ kind: 'topic', month: '2026-08', deleted: false });
    expect(seen.connection?.endpointUrl).toBe('postgres://replica/crm');
    expect(seen.listOpts).toEqual({ month: '2026-08', limit: 50 });
  });

  it('malformed month → 400 invalid_month (never reaches the adapter)', async () => {
    const { ds, seen } = fakeAdapter({ storyId: STORY });
    const { deps } = fakeDeps(APPROVED);
    const app = await build(await registryWithAdapter(ds), deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/stats/topic?month=2026-8` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_month');
    expect(seen.connection).toBeUndefined();
  });

  it('unknown kind → 400 invalid_stat_kind', async () => {
    const { ds } = fakeAdapter({ storyId: STORY });
    const { deps } = fakeDeps(APPROVED);
    const app = await build(await registryWithAdapter(ds), deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/stats/venue?month=2026-08` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_stat_kind');
  });

  it('adapter without listStats → 501 source_not_configured (feature-detected, not a crash)', async () => {
    const { ds } = fakeAdapter({ storyId: STORY, noList: true });
    const { deps } = fakeDeps(APPROVED);
    const app = await build(await registryWithAdapter(ds), deps);
    const res = await app.inject({ method: 'GET', url: `/source/${STORY}/stats/event?month=2026-08` });
    expect(res.statusCode).toBe(501);
  });
});
