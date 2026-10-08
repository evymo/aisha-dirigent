/**
 * svc-fio-bank — the sync date range goes into the Fio API URL path, next to
 * the API token. Only plain calendar dates may get there; anything else is a
 * 400 before any outbound call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveFioDateRange } from '../lib/dateRange.js';

const { mockRpcService, mockVerifyToken, mockIsAdminOrStaff, mockFetch } = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockIsAdminOrStaff: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));
vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  isAdminOrStaff: mockIsAdminOrStaff,
  AuthError: class extends Error { statusCode = 401; },
}));
vi.mock('../config.js', () => ({
  config: {
    fioApiTokenEnv: 'env-fio-token',
    fioApiBase: 'https://api.fio.test/rest',
    fioApiTimeoutMs: 1_000,
  },
}));

const NOW = new Date('2026-10-08T12:00:00Z');

describe('resolveFioDateRange', () => {
  it('defaults to the last 30 days up to today', () => {
    expect(resolveFioDateRange({}, NOW)).toEqual({ ok: true, fromDate: '2026-09-08', toDate: '2026-10-08' });
  });

  it('accepts an explicit calendar range', () => {
    expect(resolveFioDateRange({ from_date: '2026-01-01', to_date: '2026-01-31' }, NOW))
      .toEqual({ ok: true, fromDate: '2026-01-01', toDate: '2026-01-31' });
  });

  it.each([
    ['path traversal', '../../last'],
    ['query injection', '2026-01-01?x=1'],
    ['encoded slash', '2026-01-01%2Fx'],
    ['trailing text', '2026-01-01/transactions'],
    ['date with time', '2026-01-01T00:00:00Z'],
    ['empty string', ''],
    ['non-existent day', '2026-02-30'],
    ['non-string', 20260101],
  ])('rejects from_date: %s', (_label, value) => {
    const result = resolveFioDateRange({ from_date: value, to_date: '2026-03-01' }, NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed to_date', () => {
    expect(resolveFioDateRange({ from_date: '2026-01-01', to_date: '../x' }, NOW).ok).toBe(false);
  });

  it('rejects a reversed range', () => {
    const result = resolveFioDateRange({ from_date: '2026-02-01', to_date: '2026-01-01' }, NOW);
    expect(result).toEqual({ ok: false, reason: 'from_date must not be after to_date' });
  });
});

describe('POST /sync — date range validated before the Fio call', () => {
  beforeEach(() => {
    mockRpcService.mockReset().mockImplementation(async (fn: string) => {
      if (fn === 'get_system_config') return { enabled: true, check_interval_minutes: 30 };
      if (fn === 'edge_app_secrets') return { rows: [{ key: 'fio_bank_api_token', value: 'db-token' }] };
      if (fn === 'commerce_base_currency') return 'CZK';
      return null;
    });
    mockVerifyToken.mockReset().mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReset().mockReturnValue(true);
    mockFetch.mockReset();
    (globalThis as { fetch: unknown }).fetch = mockFetch;
  });

  async function callSync(body: Record<string, unknown>) {
    const { syncRoutes } = await import('../routes/sync.js');
    const handlers = new Map<string, (req: unknown, reply: unknown) => Promise<unknown>>();
    const app = {
      post: vi.fn((p: string, h: (req: unknown, reply: unknown) => Promise<unknown>) => handlers.set(`POST ${p}`, h)),
    } as unknown as Parameters<typeof syncRoutes>[0];
    await syncRoutes(app);
    const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
    const reply = {
      status(c: number) { calls.status = c; return reply; },
      send(b: unknown) { calls.body = b; return reply; },
    };
    const log = { info: vi.fn(), warn: vi.fn() };
    await handlers.get('POST /sync')!({ headers: { authorization: 'Bearer t' }, body, log }, reply);
    return calls;
  }

  it('400 and no outbound call for a crafted from_date', async () => {
    const calls = await callSync({ from_date: '../../set-last-date/2026-01-01' });
    expect(calls.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('a valid range reaches Fio with exactly that range in the path', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ accountStatement: {} }), { status: 200 }));
    await callSync({ from_date: '2026-01-01', to_date: '2026-01-31' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0]))
      .toBe('https://api.fio.test/rest/periods/db-token/2026-01-01/2026-01-31/transactions.json');
  });
});
