/**
 * Unit tests for svc-push send-push-notification route — role-targeted broadcast.
 *
 * Covers the three contract invariants:
 *   1. Broadcast: service-role (or admin/staff) caller with target_roles resolves
 *      recipients and delegates to the shared push delivery.
 *   2. Auth-reject: no auth header → 401 (matches the e2e smoke expectation).
 *   3. Validation-reject: neither recipients nor target_roles → 400.
 *
 * External boundaries mocked: auth (JWT/service-role verification), role
 * resolution + delivery (both go through rpcService / deliverPush).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeAuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const { mockVerifyServiceRole, mockVerifyToken, mockIsAdminOrStaff, mockRpcService, mockDeliverPush } = vi.hoisted(() => ({
  mockVerifyServiceRole: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockIsAdminOrStaff: vi.fn(),
  mockRpcService: vi.fn(),
  mockDeliverPush: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  AuthError: FakeAuthError,
  verifyServiceRole: mockVerifyServiceRole,
  verifyToken: mockVerifyToken,
  isAdminOrStaff: mockIsAdminOrStaff,
}));
vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));
vi.mock('../routes/send-push.js', () => ({ deliverPush: mockDeliverPush }));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(`POST ${p}`, h));
  return {
    app: { post } as unknown as Parameters<typeof import('../routes/send-push-notification.js').sendPushNotificationRoute>[0],
    handlers,
  };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function postBroadcast(body: unknown, headers: Record<string, string> = {}) {
  const { sendPushNotificationRoute } = await import('../routes/send-push-notification.js');
  const { app, handlers } = makeApp();
  await sendPushNotificationRoute(app);
  const { reply, calls } = makeReply();
  const req = { body, headers, log: { error: vi.fn() } };
  await handlers.get('POST /send-push-notification')!(req, reply);
  return calls;
}

const SERVICE_HEADER = { authorization: 'Bearer service-token' };

beforeEach(() => {
  mockVerifyServiceRole.mockReset();
  mockVerifyToken.mockReset();
  mockIsAdminOrStaff.mockReset().mockReturnValue(false);
  mockRpcService.mockReset().mockResolvedValue([]);
  mockDeliverPush.mockReset().mockResolvedValue({
    success: true, sent: 2, failed: 0,
    mobile_sent: 1, mobile_failed: 0, mobile_targeted: 1,
    web_sent: 1, web_failed: 0, web_targeted: 1,
    channels: { mobile: true, web: true },
  });
});

describe('POST /send-push-notification — broadcast', () => {
  it('resolves target_roles → user_ids and delegates to deliverPush', async () => {
    // service-role passes
    mockVerifyServiceRole.mockReturnValue(undefined);
    // two roles, overlapping user u-1 → deduped to 3 unique recipients
    mockRpcService
      .mockResolvedValueOnce([{ user_id: 'u-1' }, { user_id: 'u-2' }])
      .mockResolvedValueOnce([{ user_id: 'u-1' }, { user_id: 'u-3' }]);

    const calls = await postBroadcast(
      { title: 'Alert', body: 'Sentry spike', category: 'security', target_roles: ['admin', 'staff'] },
      SERVICE_HEADER,
    );

    expect(mockRpcService).toHaveBeenCalledWith('get_keycloak_ids_for_role', { p_role: 'admin' });
    expect(mockRpcService).toHaveBeenCalledWith('get_keycloak_ids_for_role', { p_role: 'staff' });
    // deliverPush gets the 3 deduped recipients and the category threaded as data
    expect(mockDeliverPush).toHaveBeenCalledTimes(1);
    const [payloadArg, recipientsArg] = mockDeliverPush.mock.calls[0];
    expect(recipientsArg).toEqual(['u-1', 'u-2', 'u-3']);
    expect(payloadArg).toMatchObject({ title: 'Alert', body: 'Sentry spike', data: { category: 'security' } });
    expect(calls.status).toBe(null); // 200 (no explicit status)
    expect(calls.body).toMatchObject({ recipients: 3, target_roles: ['admin', 'staff'], sent: 2 });
  });

  it('admin/staff user JWT is authorized when not a service token', async () => {
    mockVerifyServiceRole.mockImplementation(() => { throw new FakeAuthError(403, 'wrong'); });
    mockVerifyToken.mockResolvedValue({ userId: 'admin-1', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);

    const calls = await postBroadcast(
      { title: 't', body: 'b', user_ids: ['u-1'] },
      { authorization: 'Bearer admin-jwt' },
    );

    expect(mockDeliverPush).toHaveBeenCalledTimes(1);
    expect(calls.status).toBe(null);
  });
});

describe('POST /send-push-notification — auth reject', () => {
  it('401 when no auth header (service-role missing AND no user JWT)', async () => {
    mockVerifyServiceRole.mockImplementation(() => { throw new FakeAuthError(401, 'missing'); });
    mockVerifyToken.mockRejectedValue(new FakeAuthError(401, 'missing'));

    const calls = await postBroadcast({ user_id: 'u-1', title: 't', body: 'b' }, {});

    expect(calls.status).toBe(401);
    expect(mockDeliverPush).not.toHaveBeenCalled();
  });

  it('403 when a valid user JWT lacks admin/staff', async () => {
    mockVerifyServiceRole.mockImplementation(() => { throw new FakeAuthError(403, 'wrong'); });
    mockVerifyToken.mockResolvedValue({ userId: 'user-1', roles: ['member'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(false);

    const calls = await postBroadcast({ user_id: 'u-1', title: 't', body: 'b' }, { authorization: 'Bearer member-jwt' });

    expect(calls.status).toBe(403);
    expect(mockDeliverPush).not.toHaveBeenCalled();
  });
});

describe('POST /send-push-notification — validation reject', () => {
  beforeEach(() => {
    mockVerifyServiceRole.mockReturnValue(undefined); // authorized
  });

  it('400 when neither recipients nor target_roles are given', async () => {
    const calls = await postBroadcast({ title: 't', body: 'b' }, SERVICE_HEADER);
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('target_roles');
    expect(mockDeliverPush).not.toHaveBeenCalled();
  });

  it('400 when title/body missing', async () => {
    const calls = await postBroadcast({ target_roles: ['admin'] }, SERVICE_HEADER);
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('title');
  });

  it('400 when user_ids is a string, not an array (no per-char recipient spread)', async () => {
    const calls = await postBroadcast(
      { title: 't', body: 'b', user_ids: 'abc' },
      SERVICE_HEADER,
    );
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('user_ids');
    // Critically: NOT resolved to 3 single-character recipients ['a','b','c'].
    expect(mockDeliverPush).not.toHaveBeenCalled();
  });

  it('400 when user_id is present but not a string', async () => {
    const calls = await postBroadcast(
      { title: 't', body: 'b', user_id: 123 },
      SERVICE_HEADER,
    );
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('user_id');
    expect(mockDeliverPush).not.toHaveBeenCalled();
  });

  it('200 with zero counts when roles resolve to no users (well-formed but empty)', async () => {
    mockRpcService.mockResolvedValue([]); // no members
    const calls = await postBroadcast({ title: 't', body: 'b', target_roles: ['ghost'] }, SERVICE_HEADER);
    expect(calls.status).toBe(null);
    expect(calls.body).toMatchObject({ recipients: 0, sent: 0 });
    expect(mockDeliverPush).not.toHaveBeenCalled();
  });
});
