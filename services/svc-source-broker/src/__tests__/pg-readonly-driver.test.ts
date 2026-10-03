/**
 * source-pg.test.ts — SourcePgClient unit tests
 *
 * Mocks the `pg` Client and verifies:
 *   - Engagement query uses positional parameter $1 (not interpolation)
 *   - Row → typed object mapping handles nullable fields correctly
 *   - probe() error path returns ok:false with message (no exception)
 *   - Empty result set returns null (not exception)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SourcePgClient } from '../clients/pg-readonly-driver.js';
import type { SourceBrokerConfig } from '../config.js';

const baseConfig: SourceBrokerConfig = {
  postgrestUrl: 'http://postgrest:3000',
  postgrestServiceToken: 'token',
  postgresUrl: 'postgres://localhost/test',
  keycloakUrl: 'http://keycloak',
  keycloakRealm: 'aisha',
  sourceApiUrl: 'http://source-api',
  sourceServiceEmail: 's@s',
  sourceServicePassword: 'pw',
  sourcePgUrl: 'postgres://readonly@localhost/source',
  sourceAuthHandshakeOutgoing: 'OUT',
  sourceAuthHandshakeIncoming: 'IN',
  jwtCacheTtlMs: 3_600_000,
  webhookHmacSecret: 'secret',
  syncIntervalMs: 86_400_000,
  port: 8090,
  logLevel: 'info',
  corsAllowlist: '',
  rateLimitEnabled: false,
  oidcAppClientId: 'aisha-app',
  devAllowUnauthedSync: false,
  aishaGatewayUrl: 'http://gateway:3001',
  aishaGatewayIntranetKey: '',
  aishaJwtSecret: '',
  aishaJwtExpSec: 3600,
  aishaMemberRole: 'authenticated',
};

// Mock the pg module
vi.mock('pg', () => {
  const responseQueue: unknown[] = [];
  const querySpy = vi.fn(async (..._args: unknown[]) => {
    const next = responseQueue.shift();
    if (next === undefined) {
      return { rows: [], rowCount: 0 };
    }
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    Client: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      query: querySpy,
    })),
    __responseQueue: responseQueue,
    __querySpy: querySpy,
  };
});

async function pgMocks() {
  const mod = (await import('pg')) as unknown as {
    __responseQueue: unknown[];
    __querySpy: ReturnType<typeof vi.fn>;
  };
  return { queue: mod.__responseQueue, spy: mod.__querySpy };
}

describe('SourcePgClient.getEngagementForUser', () => {
  beforeEach(async () => {
    const { queue, spy } = await pgMocks();
    queue.length = 0;
    spy.mockClear();
  });

  it('returns mapped SourceEngagement when row found', async () => {
    const { queue } = await pgMocks();
    queue.push({
      rowCount: 1,
      rows: [{
        user_id: '11111111-1111-1111-1111-111111111111',
        email: 'bob@source',
        display_name: 'Bob',
        language: 'EN',
        registered_at: '2025-07-27T00:00:00Z',
        last_activity_at: '2026-05-21T18:00:00Z',
        is_instructor: true,
        app_accesses_30d: 1,
        app_accesses_90d: 1,
        events_created_30d: 2,
        events_created_90d: 5,
        audience_size: 120,
        unique_followers_30d: 8,
        total_attendance_30d: 25,
      }],
    });

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    const result = await client.getEngagementForUser('11111111-1111-1111-1111-111111111111');

    expect(result).not.toBeNull();
    expect(result!.userId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result!.isInstructor).toBe(true);
    expect(result!.eventsCreated30d).toBe(2);
    expect(result!.audienceSize).toBe(120);
    expect(result!.uniqueFollowers30d).toBe(8);
    expect(result!.totalAttendance30d).toBe(25);
  });

  it('returns null when row count is 0', async () => {
    const { queue } = await pgMocks();
    queue.push({ rowCount: 0, rows: [] });

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    const result = await client.getEngagementForUser('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('uses positional $1 parameter (no SQL string interpolation)', async () => {
    const { queue, spy } = await pgMocks();
    queue.push({ rowCount: 0, rows: [] });

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    await client.getEngagementForUser('22222222-2222-2222-2222-222222222222');

    const [sql, params] = spy.mock.calls[0];
    expect(sql).toContain('$1');
    expect(sql).toMatch(/WHERE\s+u\.id\s*=\s*\$1/);
    expect(params).toEqual(['22222222-2222-2222-2222-222222222222']);
  });

  it('handles nullable email and display_name without exception', async () => {
    const { queue } = await pgMocks();
    queue.push({
      rowCount: 1,
      rows: [{
        user_id: 'u',
        email: null,
        display_name: null,
        language: null,
        registered_at: null,
        last_activity_at: null,
        is_instructor: false,
        app_accesses_30d: 0,
        app_accesses_90d: 0,
        events_created_30d: 0,
        events_created_90d: 0,
        audience_size: 0,
        unique_followers_30d: 0,
        total_attendance_30d: 0,
      }],
    });

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    const result = await client.getEngagementForUser('u');
    expect(result!.email).toBeNull();
    expect(result!.displayName).toBeNull();
    expect(result!.language).toBeNull();
  });

  it('throws clear error when called before connect()', async () => {
    const client = new SourcePgClient(baseConfig);
    await expect(client.getEngagementForUser('u')).rejects.toThrow(/not connected/);
  });
});

describe('SourcePgClient.getRecentActiveUserIds', () => {
  beforeEach(async () => {
    const { queue, spy } = await pgMocks();
    queue.length = 0;
    spy.mockClear();
  });

  it('passes since timestamp and limit as parameters', async () => {
    const { queue, spy } = await pgMocks();
    queue.push({ rowCount: 0, rows: [] });
    const since = new Date('2026-05-01T00:00:00Z');

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    await client.getRecentActiveUserIds(since, 250);

    const [_, params] = spy.mock.calls[0];
    expect(params).toEqual([since.toISOString(), 250]);
  });

  it('maps result rows to camelCase SourceActiveUserId[]', async () => {
    const { queue } = await pgMocks();
    queue.push({
      rowCount: 2,
      rows: [
        { user_id: 'a', email: 'a@s', display_name: 'A', last_activity_at: '2026-05-22T10:00:00Z' },
        { user_id: 'b', email: null, display_name: null, last_activity_at: '2026-05-22T09:00:00Z' },
      ],
    });

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    const result = await client.getRecentActiveUserIds(new Date());
    expect(result).toHaveLength(2);
    expect(result[0].userId).toBe('a');
    expect(result[0].displayName).toBe('A');
    expect(result[1].displayName).toBeNull();
  });
});

describe('SourcePgClient.probe', () => {
  beforeEach(async () => {
    const { queue, spy } = await pgMocks();
    queue.length = 0;
    spy.mockClear();
  });

  it('returns ok:true with latency when query succeeds', async () => {
    const { queue } = await pgMocks();
    queue.push({ rowCount: 1, rows: [{ '?column?': 1 }] });

    const client = new SourcePgClient(baseConfig);
    const result = await client.probe();
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.error).toBeUndefined();
  });

  it('returns ok:false with error message when query fails (no throw)', async () => {
    const { queue } = await pgMocks();
    queue.push(new Error('permission denied for table core_appuser'));

    const client = new SourcePgClient(baseConfig);
    const result = await client.probe();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('permission denied');
  });
});

describe('SourcePgClient.getCommunityKpiSnapshot', () => {
  beforeEach(async () => {
    const { queue, spy } = await pgMocks();
    queue.length = 0;
    spy.mockClear();
  });

  it('returns null when no snapshot rows exist', async () => {
    const { queue } = await pgMocks();
    queue.push({ rowCount: 0, rows: [] });

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    const result = await client.getCommunityKpiSnapshot();
    expect(result).toBeNull();
  });

  it('maps snapshot row to camelCase SourceCommunityKpi', async () => {
    const { queue } = await pgMocks();
    queue.push({
      rowCount: 1,
      rows: [{
        snapshot_date: '2026-05-23',
        users_total: 1240,
        users_new: 45,
        users_monthly: 380,
        users_weekly: 67,
        users_daily: 12,
        events_total: 250,
        posts_total: 980,
      }],
    });

    const client = new SourcePgClient(baseConfig);
    await client.connect();
    const kpi = await client.getCommunityKpiSnapshot();
    expect(kpi!.usersTotal).toBe(1240);
    expect(kpi!.usersDaily).toBe(12);
    expect(kpi!.snapshotDate).toBe('2026-05-23');
  });
});
