/**
 * Unit tests for svc-stripe `POST /checkout`.
 *
 * ⛔ Do 2026-10-07 route volala `edge_profiles` (get_user_profile, set_stripe_customer)
 * a `edge_orders.update_order` UŽIVATELSKÝM tokenem. Oba dispečery to členovi
 * odmítají (edge_profiles: jen správa/služba, update_order: jen služba), takže
 * checkout padal každému členovi. Teď: kontext objednávky (vlastnictví) čte
 * uživatelský token, profil a zápis objednávky služba s user_id z ověřeného tokenu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcService, mockRpcUser, mockCreateStripeClient, mockVerifyToken, mockSessionsCreate, mockCustomersCreate } =
  vi.hoisted(() => ({
    mockRpcService: vi.fn(),
    mockRpcUser: vi.fn(),
    mockCreateStripeClient: vi.fn(),
    mockVerifyToken: vi.fn(),
    mockSessionsCreate: vi.fn(),
    mockCustomersCreate: vi.fn(),
  }));

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../lib/stripe-client.js', () => ({ createStripeClient: mockCreateStripeClient }));
vi.mock('../lib/currency.js', () => ({ resolveBaseCurrency: async () => 'CZK' }));
vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService, rpcUser: mockRpcUser }));

import { checkoutRoute } from '../routes/checkout.js';

type Handler = (req: unknown, reply: unknown) => Promise<unknown>;

async function route(): Promise<Handler> {
  const handlers = new Map<string, Handler>();
  const app = { post: (path: string, h: Handler) => handlers.set(path, h) };
  await checkoutRoute(app as unknown as Parameters<typeof checkoutRoute>[0]);
  const h = handlers.get('/checkout');
  if (!h) throw new Error('route /checkout se nezaregistrovala');
  return h;
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
const ORDER = 'order-1';
const req = { headers: { authorization: 'Bearer jwt-1' }, body: { orderId: ORDER } };

describe('POST /checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue({ userId: USER, email: 'clen@example.com' });
    mockCreateStripeClient.mockResolvedValue({
      checkout: { sessions: { create: mockSessionsCreate } },
      customers: { create: mockCustomersCreate },
    });
    mockSessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.example/cs_1' });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_new' });
    mockRpcUser.mockImplementation(async (fn: string, params: { p_action: string }) => {
      if (fn === 'edge_orders' && params.p_action === 'get_checkout_context') {
        return { row: { id: ORDER, status: 'pending', total: 100, currency: 'CZK', shipping: 0, order_items: [] } };
      }
      return { ok: true };
    });
    mockRpcService.mockImplementation(async (fn: string, params: { p_action: string }) => {
      if (fn === 'edge_profiles' && params.p_action === 'get_user_profile') return { row: { stripe_customer_id: null } };
      return { ok: true };
    });
  });

  it('vlastnictví objednávky ověří uživatelský token (get_checkout_context)', async () => {
    const { reply } = makeReply();
    await (await route())(req, reply);
    expect(mockRpcUser).toHaveBeenCalledWith(
      'edge_orders',
      expect.objectContaining({ p_action: 'get_checkout_context', p_payload: { order_id: ORDER, user_id: USER } }),
      'jwt-1',
    );
  });

  it('⛔ profil čte a zákazníka Stripe zapisuje služba pro uživatele z tokenu', async () => {
    const { reply } = makeReply();
    await (await route())(req, reply);
    expect(mockRpcService).toHaveBeenCalledWith('edge_profiles', { p_action: 'get_user_profile', p_payload: { user_id: USER } });
    expect(mockRpcService).toHaveBeenCalledWith('edge_profiles', {
      p_action: 'set_stripe_customer',
      p_payload: { stripe_customer_id: 'cus_new', user_id: USER },
    });
    expect(mockRpcUser).not.toHaveBeenCalledWith('edge_profiles', expect.anything(), expect.anything());
  });

  it('⛔ update_order zapisuje služba, ne uživatelský token', async () => {
    const { reply } = makeReply();
    await (await route())(req, reply);
    expect(mockRpcService).toHaveBeenCalledWith('edge_orders', expect.objectContaining({ p_action: 'update_order' }));
    expect(mockRpcUser).not.toHaveBeenCalledWith('edge_orders', expect.objectContaining({ p_action: 'update_order' }), expect.anything());
  });

  it('cizí nebo neexistující objednávka: 404, nic se nezapisuje', async () => {
    mockRpcUser.mockResolvedValue({ row: null });
    const { reply, calls } = makeReply();
    await (await route())(req, reply);
    expect(calls.status).toBe(404);
    expect(mockRpcService).not.toHaveBeenCalled();
  });
});
