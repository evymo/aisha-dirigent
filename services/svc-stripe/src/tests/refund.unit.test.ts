/**
 * Unit tests for svc-stripe refund route (`POST /refund`).
 *
 * Refunds move money, so the route is admin/staff-gated. We assert:
 *   (a) admin caller + valid body      => 200 { refundId, status }
 *   (b) authenticated non-admin caller => 403
 *   (b') missing/invalid auth          => 401 (AuthError from verifyToken)
 *   (c) missing paymentIntentId        => 400
 *
 * Stripe SDK, auth, and the audit RPC are all mocked at the module boundary so
 * the test runs fully offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerifyToken,
  mockIsAdminOrStaff,
  mockCreateStripeClient,
  mockRefundsCreate,
  mockRpcService,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockIsAdminOrStaff: vi.fn(),
  mockCreateStripeClient: vi.fn(),
  mockRefundsCreate: vi.fn(),
  mockRpcService: vi.fn(),
}));

// Local AuthError class the route checks with `instanceof`.
class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

vi.mock('../auth.js', () => ({
  AuthError,
  verifyToken: mockVerifyToken,
  isAdminOrStaff: mockIsAdminOrStaff,
}));

vi.mock('../lib/stripe-client.js', () => ({
  createStripeClient: mockCreateStripeClient,
}));

vi.mock('../postgrest.js', () => ({
  rpcService: mockRpcService,
}));

// Fastify stub — capture the handler registered for POST /refund.
function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  return { app: { post } as unknown as Parameters<typeof import('../routes/refund.js').refundRoute>[0], handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function postRefund(opts: {
  body?: unknown;
  authHeader?: string;
}) {
  const { refundRoute } = await import('../routes/refund.js');
  const { app, handlers } = makeApp();
  await refundRoute(app);
  const { reply, calls } = makeReply();

  const req = {
    headers: { authorization: opts.authHeader ?? 'Bearer test.jwt' },
    body: opts.body,
    log: { error: vi.fn() },
  };
  await handlers.get('/refund')!(req, reply);
  return calls;
}

beforeEach(() => {
  mockVerifyToken.mockReset();
  mockIsAdminOrStaff.mockReset();
  mockCreateStripeClient.mockReset();
  mockRefundsCreate.mockReset();
  mockRpcService.mockReset();

  // Sensible defaults: an admin caller with a working Stripe client.
  mockVerifyToken.mockResolvedValue({ userId: 'admin-uuid', email: 'a@x.io', roles: ['admin'], claims: {} });
  mockIsAdminOrStaff.mockReturnValue(true);
  mockCreateStripeClient.mockResolvedValue({ refunds: { create: mockRefundsCreate } });
  mockRpcService.mockResolvedValue(undefined);
});

// ── (a) happy path ─────────────────────────────────────────────
describe('admin refund happy path', () => {
  it('200 with { refundId, status } and calls stripe.refunds.create + audit', async () => {
    mockRefundsCreate.mockResolvedValue({ id: 're_test_123', status: 'succeeded' });

    const calls = await postRefund({ body: { paymentIntentId: 'pi_test_abc', amount: 500 } });

    expect(calls.status).toBeNull(); // implicit 200
    expect(calls.body).toEqual({ refundId: 're_test_123', status: 'succeeded' });
    // stable idempotency key (paymentIntentId + amount) deduplicates retries
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_test_abc', amount: 500 },
      { idempotencyKey: 'refund:pi_test_abc:500' },
    );
    // audit log written for the admin who performed the refund
    expect(mockRpcService).toHaveBeenCalledWith(
      'record_audit_log',
      expect.objectContaining({
        p_action: 'payment.refunded',
        p_resource_type: 'refund',
        p_resource_id: 'pi_test_abc',
        p_user_id: 'admin-uuid',
        p_details: expect.objectContaining({ stripe_refund_id: 're_test_123', amount: 500 }),
      }),
    );
  });

  it('omits amount for full refund when amount is not supplied', async () => {
    mockRefundsCreate.mockResolvedValue({ id: 're_full', status: 'pending' });

    const calls = await postRefund({ body: { paymentIntentId: 'pi_full' } });

    expect(calls.body).toEqual({ refundId: 're_full', status: 'pending' });
    // full refund => 'full' sentinel in the idempotency key (no amount)
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_full' },
      { idempotencyKey: 'refund:pi_full:full' },
    );
  });
});

// ── (b) auth / role rejection ──────────────────────────────────
describe('authorization gate', () => {
  it('403 when caller is authenticated but lacks admin/staff role', async () => {
    mockIsAdminOrStaff.mockReturnValue(false);
    mockVerifyToken.mockResolvedValue({ userId: 'u1', roles: ['member'], claims: {} });

    const calls = await postRefund({ body: { paymentIntentId: 'pi_x' } });

    expect(calls.status).toBe(403);
    expect((calls.body as { error: string }).error).toMatch(/admin or staff/i);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('401 when the token is missing/invalid (verifyToken throws AuthError)', async () => {
    mockVerifyToken.mockRejectedValue(new AuthError(401, 'Missing bearer token'));

    const calls = await postRefund({ authHeader: '', body: { paymentIntentId: 'pi_x' } });

    expect(calls.status).toBe(401);
    expect((calls.body as { error: string }).error).toBe('Missing bearer token');
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

// ── (c) validation ─────────────────────────────────────────────
describe('body validation', () => {
  it('400 when paymentIntentId is missing', async () => {
    const calls = await postRefund({ body: { amount: 100 } });

    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toMatch(/paymentIntentId/);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('400 when amount is present but not a positive integer', async () => {
    const calls = await postRefund({ body: { paymentIntentId: 'pi_x', amount: -5 } });

    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toMatch(/amount/);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

// ── Stripe error mapping ───────────────────────────────────────
describe('stripe error mapping', () => {
  it('maps a Stripe error statusCode to the response status', async () => {
    const stripeErr = Object.assign(new Error('No such payment_intent: pi_missing'), {
      type: 'StripeInvalidRequestError',
      statusCode: 404,
    });
    mockRefundsCreate.mockRejectedValue(stripeErr);

    const calls = await postRefund({ body: { paymentIntentId: 'pi_missing' } });

    expect(calls.status).toBe(404);
    expect((calls.body as { error: string }).error).toContain('No such payment_intent');
  });
});
