/**
 * Unit tests for svc-push send-push route — auth + payload validation + delivery.
 *
 * The endpoint now requires auth: a service-role token (the internal campaign /
 * reminder callers) OR a user JWT confined to self-target. We cover:
 *   0. Auth: service-role authorized; user JWT confined to self; no auth → 401
 *   1. Required fields enforced (title, body)
 *   2. At least one user identifier required
 *   3. At least one delivery channel required
 *   4. No delivery happens when there are zero sessions/subscriptions
 *      (empty-userlist edge case — no PII leak through `?` placeholders)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeAuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const { mockVerifyServiceRole, mockVerifyToken, mockRpcService, mockIsFcmConfigured, mockIsWebPushConfigured, mockSendFcmMessage, mockSendWebPushNotifications } = vi.hoisted(() => ({
  mockVerifyServiceRole: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockRpcService: vi.fn(),
  mockIsFcmConfigured: vi.fn(),
  mockIsWebPushConfigured: vi.fn(),
  mockSendFcmMessage: vi.fn(),
  mockSendWebPushNotifications: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  AuthError: FakeAuthError,
  verifyServiceRole: mockVerifyServiceRole,
  verifyToken: mockVerifyToken,
}));
vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));
vi.mock('../lib/fcm.js', () => ({
  isFcmConfigured: mockIsFcmConfigured,
  getFcmAccessToken: vi.fn().mockResolvedValue('token'),
  getFcmProjectId: vi.fn().mockReturnValue('project'),
  sendFcmMessage: mockSendFcmMessage,
}));
vi.mock('../lib/web-push.js', () => ({
  isWebPushConfigured: mockIsWebPushConfigured,
  sendWebPushNotifications: mockSendWebPushNotifications,
}));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((p: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(`POST ${p}`, h));
  return {
    app: { post } as unknown as Parameters<typeof import('../routes/send-push.js').sendPushRoute>[0],
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

const SERVICE_HEADER = { authorization: 'Bearer service-token' };

async function postSend(body: unknown, headers: Record<string, string> = SERVICE_HEADER) {
  const { sendPushRoute } = await import('../routes/send-push.js');
  const { app, handlers } = makeApp();
  await sendPushRoute(app);
  const { reply, calls } = makeReply();
  await handlers.get('POST /send')!({ body, headers, log: { error: vi.fn() } }, reply);
  return calls;
}

beforeEach(() => {
  // Default: caller presents a valid service-role token.
  mockVerifyServiceRole.mockReset().mockReturnValue(undefined);
  mockVerifyToken.mockReset();
  mockRpcService.mockReset().mockResolvedValue(null);
  mockIsFcmConfigured.mockReset().mockReturnValue(true);
  mockIsWebPushConfigured.mockReset().mockReturnValue(true);
  mockSendFcmMessage.mockReset().mockResolvedValue({ name: 'msg-1' });
  mockSendWebPushNotifications.mockReset().mockResolvedValue([]);
});

describe('POST /send — auth contract', () => {
  it('401 when neither service-role token nor user JWT is valid', async () => {
    mockVerifyServiceRole.mockImplementation(() => { throw new FakeAuthError(401, 'missing'); });
    mockVerifyToken.mockRejectedValue(new FakeAuthError(401, 'missing'));

    const calls = await postSend({ title: 't', body: 'b', user_id: 'u-1' }, {});

    expect(calls.status).toBe(401);
    expect(mockSendFcmMessage).not.toHaveBeenCalled();
    expect(mockSendWebPushNotifications).not.toHaveBeenCalled();
  });

  it('user JWT is confined to self-target — arbitrary user_ids are dropped', async () => {
    mockVerifyServiceRole.mockImplementation(() => { throw new FakeAuthError(403, 'wrong'); });
    mockVerifyToken.mockResolvedValue({ userId: 'self-1', roles: ['member'], claims: {} });
    // Mobile-session lookup echoes back which user ids were requested.
    mockRpcService.mockResolvedValue(null);

    await postSend(
      { title: 't', body: 'b', user_ids: ['victim-1', 'victim-2'], send_web: false },
      { authorization: 'Bearer member-jwt' },
    );

    // The mobile-session RPC must be scoped to the caller's own id only.
    const sessionCall = mockRpcService.mock.calls.find(
      ([fn]) => fn === 'edge_mobile_notifications',
    );
    expect(sessionCall?.[1]).toMatchObject({
      p_action: 'get_mobile_sessions',
      p_payload: { user_ids: ['self-1'] },
    });
  });
});

describe('POST /send — payload validation', () => {
  it('400 when title missing', async () => {
    const calls = await postSend({ body: 'b', user_id: 'u' });
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('title');
  });

  it('400 when body missing', async () => {
    const calls = await postSend({ title: 't', user_id: 'u' });
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('body');
  });

  it('400 when both user_id AND user_ids are missing (no recipient)', async () => {
    const calls = await postSend({ title: 't', body: 'b' });
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('user_id');
  });

  it('400 when both delivery channels are disabled (send_mobile=false AND send_web=false)', async () => {
    const calls = await postSend({
      title: 't', body: 'b', user_id: 'u', send_mobile: false, send_web: false,
    });
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('No delivery channels');
  });

  it('accepts singular user_id', async () => {
    const calls = await postSend({ title: 't', body: 'b', user_id: 'u-1' });
    expect(calls.status).not.toBe(400);
  });

  it('accepts plural user_ids array', async () => {
    const calls = await postSend({ title: 't', body: 'b', user_ids: ['u-1', 'u-2'] });
    expect(calls.status).not.toBe(400);
  });

  it('empty user_ids array → 400 (no implicit broadcast)', async () => {
    const calls = await postSend({ title: 't', body: 'b', user_ids: [] });
    expect(calls.status).toBe(400);
  });
});

describe('POST /send — no-target edge case (no PII leak via SQL nulls)', () => {
  it('returns gracefully when no mobile sessions AND no web subs for the user', async () => {
    mockRpcService.mockResolvedValue(null); // no sessions, no subs
    const calls = await postSend({ title: 't', body: 'b', user_id: 'u-none' });
    // The route should not error — it should succeed with 0 deliveries
    expect(calls.status).not.toBe(500);
    // And critically: no actual push call was made
    expect(mockSendFcmMessage).not.toHaveBeenCalled();
    expect(mockSendWebPushNotifications).not.toHaveBeenCalled();
  });

  it('zero registered devices → success with zero counts (empty result, not an error)', async () => {
    mockRpcService.mockResolvedValue(null); // legitimate empty: user has no devices
    const calls = await postSend({ title: 't', body: 'b', user_id: 'u-none' });

    expect(calls.status).toBe(null); // 200 — no error status
    expect(calls.body).toMatchObject({
      success: true,
      sent: 0,
      failed: 0,
      mobile_sent: 0,
      web_sent: 0,
    });
  });
});

describe('POST /send — fail loud when recipient-lookup RPC throws', () => {
  it('RPC lookup THROWS (DB/network error) → 5xx, not a masked success', async () => {
    mockRpcService.mockRejectedValue(new Error('PostgREST RPC failed: 500'));
    const calls = await postSend({ title: 't', body: 'b', user_id: 'u-1' });

    expect(calls.status).toBe(502);
    expect(calls.body).toMatchObject({ success: false });
    // Must NOT report a bogus "No active push targets found" success.
    expect((calls.body as { message?: string }).message).toBeUndefined();
    expect(mockSendFcmMessage).not.toHaveBeenCalled();
    expect(mockSendWebPushNotifications).not.toHaveBeenCalled();
  });
});
