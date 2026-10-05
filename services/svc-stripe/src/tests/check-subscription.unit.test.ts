/**
 * Unit tests for svc-stripe `POST /check-subscription`.
 *
 * Route čte předplatné UŽIVATELSKÝM tokenem (RLS/nárok vlastníka), ale
 * aktivaci po potvrzení u Stripe zapisuje SLUŽBA. Od 2026-10-04 DB odmítá
 * `update_subscription` pod uživatelským tokenem — kdyby route zůstala na
 * rpcUser, aktivace by tiše selhala (chyba se tu polyká jako „non-fatal").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcService, mockRpcUser, mockCreateStripeClient, mockVerifyToken, mockSubscriptionsList } = vi.hoisted(
  () => ({
    mockRpcService: vi.fn(),
    mockRpcUser: vi.fn(),
    mockCreateStripeClient: vi.fn(),
    mockVerifyToken: vi.fn(),
    mockSubscriptionsList: vi.fn(),
  }),
);

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  AuthError: class AuthError extends Error {},
}));

vi.mock('../lib/stripe-client.js', () => ({
  createStripeClient: mockCreateStripeClient,
}));

vi.mock('../postgrest.js', () => ({
  rpcService: mockRpcService,
  rpcUser: mockRpcUser,
}));

import { checkSubscriptionRoute } from '../routes/check-subscription.js';

type Handler = (req: unknown, reply: unknown) => Promise<unknown>;

async function route(): Promise<Handler> {
  const handlers = new Map<string, Handler>();
  const app = { post: (path: string, h: Handler) => handlers.set(path, h) };
  await checkSubscriptionRoute(app as unknown as Parameters<typeof checkSubscriptionRoute>[0]);
  return handlers.get('/check-subscription')!;
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

const USER = 'user-1';
const SUB = 'sub-db-1';

describe('POST /check-subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue({ userId: USER });
    mockCreateStripeClient.mockResolvedValue({ subscriptions: { list: mockSubscriptionsList } });
    mockRpcUser.mockImplementation(async (fn: string, params: { p_action: string }) => {
      if (fn === 'edge_subscriptions' && params.p_action === 'get_user_subscriptions') {
        return { rows: [{ id: SUB, status: 'pending_payment', payment_type: 'recurring' }] };
      }
      if (fn === 'edge_profiles') return { row: { stripe_customer_id: 'cus_1' } };
      return null;
    });
    mockSubscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_stripe_1', cancel_at_period_end: false, current_period_end: 1_900_000_000, metadata: { subscription_id: SUB } }],
    });
  });

  it('čte předplatné uživatelským tokenem, jen pro sebe', async () => {
    const { reply } = makeReply();
    await (await route())({ headers: { authorization: 'Bearer jwt-1' } }, reply);

    expect(mockRpcUser).toHaveBeenCalledWith(
      'edge_subscriptions',
      expect.objectContaining({ p_action: 'get_user_subscriptions', p_payload: expect.objectContaining({ user_id: USER }) }),
      'jwt-1',
    );
  });

  it('⛔ aktivaci potvrzenou u Stripe zapisuje služba, ne uživatelský token', async () => {
    const { reply } = makeReply();
    await (await route())({ headers: { authorization: 'Bearer jwt-1' } }, reply);

    expect(mockRpcService).toHaveBeenCalledWith('edge_subscriptions', {
      p_action: 'update_subscription',
      p_payload: expect.objectContaining({ id: SUB, status: 'active', new_stripe_subscription_id: 'sub_stripe_1' }),
    });
    expect(mockRpcUser).not.toHaveBeenCalledWith(
      'edge_subscriptions',
      expect.objectContaining({ p_action: 'update_subscription' }),
      expect.anything(),
    );
  });

  it('odpověď nese stav po aktivaci, ne ten před ní', async () => {
    const { reply, calls } = makeReply();
    await (await route())({ headers: { authorization: 'Bearer jwt-1' } }, reply);

    expect(calls.body).toMatchObject({ hasActiveSubscription: true, activeSubscription: { id: SUB, status: 'active' } });
  });

  it('cizí předplatné ze Stripe metadat neaktivuje (není mezi předplatnými uživatele)', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_x', cancel_at_period_end: false, current_period_end: 1_900_000_000, metadata: { subscription_id: 'cizi' } }],
    });
    const { reply } = makeReply();
    await (await route())({ headers: { authorization: 'Bearer jwt-1' } }, reply);

    expect(mockRpcService).not.toHaveBeenCalled();
  });
});
