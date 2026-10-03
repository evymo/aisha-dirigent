/**
 * Unit tests for svc-stripe webhook route (`POST /webhook`).
 *
 * This route processes every Stripe webhook in production — payment
 * confirmations, subscription state transitions, disputes, refunds.
 * It MUST:
 *   1. Reject requests without a `stripe-signature` header (400)
 *   2. Reject requests when the signature doesn't verify against
 *      `STRIPE_WEBHOOK_SECRET` (400 + sanitised message)
 *   3. Bail out gracefully if Stripe isn't configured (500)
 *   4. For each known event type, call the right `edge_*` RPCs with
 *      the right shape
 *   5. Always reply `{ received: true }` even for unknown event types
 *      (Stripe retries on non-2xx; we don't want infinite retries for
 *      events we don't care about)
 *
 * We mock the Stripe client + rpcService + safe logger so the tests run
 * fully offline. Event payloads use minimal Stripe-shaped fixtures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRpcService,
  mockCreateStripeClient,
  mockConstructEvent,
  mockSubscriptionsRetrieve,
} = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockCreateStripeClient: vi.fn(),
  mockConstructEvent: vi.fn(),
  mockSubscriptionsRetrieve: vi.fn(),
}));

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({
    safeInfo: vi.fn(),
    safeWarn: vi.fn(),
    safeError: vi.fn(),
  }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../config.js', () => ({
  config: {
    stripeWebhookSecret: 'whsec_test_secret',
  },
}));

vi.mock('../lib/stripe-client.js', () => ({
  createStripeClient: mockCreateStripeClient,
}));

vi.mock('../postgrest.js', () => ({
  rpcService: mockRpcService,
}));

// Stripe client stub — returns the object the route expects.
function makeStripeStub() {
  return {
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
  };
}

// Fastify stub
function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  return { app: { post } as unknown as Parameters<typeof import('../routes/webhook.js').webhookRoute>[0], handlers };
}

function makeReply() {
  const calls: { status: number | null; body: unknown } = { status: null, body: undefined };
  const reply = {
    status(c: number) { calls.status = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

async function postWebhook(opts: {
  signature?: string | null;  // null = simulate header completely missing
  rawBody?: string;
  event?: unknown;            // value constructEvent will return
  constructThrows?: Error;    // makes constructEvent throw
  stripeClient?: unknown;     // override (e.g. null to simulate "not configured")
}) {
  const { webhookRoute } = await import('../routes/webhook.js');
  const { app, handlers } = makeApp();
  await webhookRoute(app);
  const { reply, calls } = makeReply();

  if (opts.stripeClient === null) {
    mockCreateStripeClient.mockResolvedValue(null);
  } else {
    mockCreateStripeClient.mockResolvedValue(opts.stripeClient ?? makeStripeStub());
  }
  if (opts.constructThrows) {
    mockConstructEvent.mockImplementation(() => { throw opts.constructThrows; });
  } else if (opts.event !== undefined) {
    mockConstructEvent.mockReturnValue(opts.event);
  }

  // signature === null → emit headers without the stripe-signature key
  // signature === undefined → default to a placeholder so other tests pass
  const headers: Record<string, string | undefined> =
    opts.signature === null
      ? {}
      : { 'stripe-signature': opts.signature ?? 'sig_test' };

  await handlers.get('/webhook')!(
    { headers, rawBody: opts.rawBody ?? '{"raw":"body"}' },
    reply,
  );
  return calls;
}

beforeEach(() => {
  mockRpcService.mockReset();
  mockCreateStripeClient.mockReset();
  mockConstructEvent.mockReset();
  mockSubscriptionsRetrieve.mockReset();
});

// ── signature path ─────────────────────────────────────────────

describe('webhook signature handling', () => {
  it('400 when stripe-signature header is missing', async () => {
    const calls = await postWebhook({ signature: null });
    expect(calls.status).toBe(400);
    expect(calls.body).toEqual({ error: 'Missing signature' });
  });

  it('500 when createStripeClient returns null (Stripe not configured)', async () => {
    const calls = await postWebhook({ stripeClient: null });
    expect(calls.status).toBe(500);
    expect(calls.body).toEqual({ error: 'Stripe not configured' });
  });

  it('400 with sanitised error when constructEvent throws (signature mismatch)', async () => {
    const calls = await postWebhook({
      constructThrows: new Error('No signatures found matching the expected signature for payload.'),
    });
    expect(calls.status).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Webhook signature verification failed');
    // Original error message is preserved (debugging aid), but no stack trace / type
    expect((calls.body as { error: string }).error).toContain('No signatures found');
  });

  it('uses raw body (NOT JSON-parsed body) for signature verification', async () => {
    // Stripe's signature is computed over the raw bytes — if we re-encode
    // (JSON.stringify(JSON.parse(...))) keys can reorder and signature breaks.
    await postWebhook({
      rawBody: '{"some":"raw","payload":"keys-in-this-order"}',
      event: { type: 'checkout.session.completed', data: { object: { metadata: {} } } },
    });
    expect(mockConstructEvent).toHaveBeenCalledWith(
      '{"some":"raw","payload":"keys-in-this-order"}',
      'sig_test',
      'whsec_test_secret',
    );
  });
});

// ── checkout.session.completed ─────────────────────────────────

describe('checkout.session.completed', () => {
  it('marks payment session completed + updates order + writes audit log', async () => {
    mockRpcService.mockResolvedValue(undefined);
    const calls = await postWebhook({
      event: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            payment_intent: 'pi_test_xyz',
            amount_total: 12000,
            currency: 'czk',
            metadata: { order_id: 'order-uuid', user_id: 'user-uuid' },
          },
        },
      },
    });

    expect(calls.body).toEqual({ received: true });
    // 1. payment session updated
    expect(mockRpcService).toHaveBeenCalledWith(
      'edge_payment_sessions',
      expect.objectContaining({
        p_action: 'update_status',
        p_payload: expect.objectContaining({
          stripe_session_id: 'cs_test_123',
          status: 'completed',
        }),
      }),
    );
    // 2. order updated
    expect(mockRpcService).toHaveBeenCalledWith(
      'edge_orders',
      expect.objectContaining({
        p_action: 'update_order',
        p_payload: expect.objectContaining({
          order_id: 'order-uuid',
          status: 'paid',
          stripe_payment_intent_id: 'pi_test_xyz',
        }),
      }),
    );
    // 3. audit log
    expect(mockRpcService).toHaveBeenCalledWith(
      'record_audit_log',
      expect.objectContaining({
        p_action: 'order.payment_completed',
        p_resource_id: 'order-uuid',
        p_user_id: 'user-uuid',
        p_details: expect.objectContaining({
          stripe_session_id: 'cs_test_123',
          amount_total: 12000,
          currency: 'czk',
        }),
      }),
    );
  });

  it('skips order update when metadata.order_id is missing', async () => {
    mockRpcService.mockResolvedValue(undefined);
    await postWebhook({
      event: {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_x', payment_intent: 'pi_x', metadata: {} } },
      },
    });
    const orderCalls = mockRpcService.mock.calls.filter((c) => c[0] === 'edge_orders');
    expect(orderCalls).toHaveLength(0);
  });

  it('activates one-time subscription when metadata says payment_type=one_time', async () => {
    mockRpcService.mockResolvedValue(undefined);
    await postWebhook({
      event: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_y',
            payment_intent: 'pi_y',
            metadata: { subscription_id: 'sub-uuid', payment_type: 'one_time' },
          },
        },
      },
    });
    expect(mockRpcService).toHaveBeenCalledWith(
      'edge_subscriptions',
      expect.objectContaining({
        p_action: 'update_subscription',
        p_payload: expect.objectContaining({
          id: 'sub-uuid',
          status: 'active',
          stripe_payment_intent_id: 'pi_y',
        }),
      }),
    );
  });
});

// ── payment_intent.payment_failed ──────────────────────────────

describe('payment_intent.payment_failed', () => {
  it('marks order as payment_failed when metadata has order_id', async () => {
    mockRpcService.mockResolvedValue(undefined);
    await postWebhook({
      event: {
        type: 'payment_intent.payment_failed',
        data: { object: { id: 'pi_fail', metadata: { order_id: 'o-1' } } },
      },
    });
    expect(mockRpcService).toHaveBeenCalledWith(
      'edge_orders',
      expect.objectContaining({
        p_action: 'update_order',
        p_payload: expect.objectContaining({ order_id: 'o-1', status: 'payment_failed' }),
      }),
    );
  });
});

// ── customer.subscription.updated ──────────────────────────────

describe('customer.subscription.updated', () => {
  it('maps Stripe status → DB status (canceled → cancelled, past_due, unpaid, else active)', async () => {
    mockRpcService.mockResolvedValue(undefined);
    const cases: { stripe: string; db: string }[] = [
      { stripe: 'canceled', db: 'cancelled' },
      { stripe: 'past_due', db: 'past_due' },
      { stripe: 'unpaid', db: 'unpaid' },
      { stripe: 'active', db: 'active' },
      { stripe: 'something_else', db: 'active' }, // default
    ];
    for (const { stripe, db } of cases) {
      mockRpcService.mockReset();
      mockRpcService.mockResolvedValue(undefined);
      await postWebhook({
        event: {
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_stripe_123',
              status: stripe,
              cancel_at_period_end: false,
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
              metadata: { subscription_id: 'sub-uuid' },
            },
          },
        },
      });
      expect(mockRpcService).toHaveBeenCalledWith(
        'edge_subscriptions',
        expect.objectContaining({
          p_action: 'update_subscription',
          p_payload: expect.objectContaining({ id: 'sub-uuid', status: db }),
        }),
      );
    }
  });

  it('uses stripe_subscription_id key when our subscription_id metadata is missing', async () => {
    mockRpcService.mockResolvedValue(undefined);
    await postWebhook({
      event: {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_no_meta',
            status: 'active',
            cancel_at_period_end: true,
            current_period_end: 1700000000,
            metadata: {},
          },
        },
      },
    });
    expect(mockRpcService).toHaveBeenCalledWith(
      'edge_subscriptions',
      expect.objectContaining({
        p_action: 'update_subscription',
        p_payload: expect.objectContaining({
          stripe_subscription_id: 'sub_no_meta',
          cancel_at_period_end: true,
        }),
      }),
    );
  });
});

// ── charge.dispute.created ─────────────────────────────────────

describe('charge.dispute.created', () => {
  it('upserts dispute + marks order disputed + writes audit log', async () => {
    mockRpcService.mockImplementation(async (fn) => {
      if (fn === 'edge_stripe_disputes') {
        // First call is find_order_by_payment_intent — return the linked order.
        return { order_id: 'order-disp', user_id: 'user-disp' };
      }
      return undefined;
    });

    await postWebhook({
      event: {
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_test',
            amount: 5000,
            currency: 'czk',
            payment_intent: 'pi_disp',
            charge: 'ch_disp',
            reason: 'fraudulent',
            status: 'needs_response',
            is_charge_refundable: true,
            evidence_details: { due_by: 1700000000 },
            network_reason_code: '4855',
            payment_method_details: { type: 'card' },
          },
        },
      },
    });

    // upsert
    expect(mockRpcService).toHaveBeenCalledWith(
      'edge_stripe_disputes',
      expect.objectContaining({
        p_action: 'upsert_dispute',
        p_payload: expect.objectContaining({
          stripe_dispute_id: 'dp_test',
          reason: 'fraudulent',
          order_id: 'order-disp',
          user_id: 'user-disp',
        }),
      }),
    );
    // order marked disputed
    expect(mockRpcService).toHaveBeenCalledWith(
      'edge_orders',
      expect.objectContaining({
        p_action: 'update_order',
        p_payload: expect.objectContaining({ order_id: 'order-disp', status: 'disputed' }),
      }),
    );
    // audit log
    expect(mockRpcService).toHaveBeenCalledWith(
      'record_audit_log',
      expect.objectContaining({
        p_action: 'dispute.created',
        p_resource_type: 'dispute',
        p_resource_id: 'order-disp',
        p_user_id: 'user-disp',
      }),
    );
  });
});

// ── unknown event type ─────────────────────────────────────────

describe('unknown event type', () => {
  it('still returns {received: true} — never 4xx (Stripe would retry forever)', async () => {
    mockRpcService.mockResolvedValue(undefined);
    const calls = await postWebhook({
      event: { type: 'invoice.upcoming', data: { object: {} } },
    });
    expect(calls.body).toEqual({ received: true });
    expect(calls.status).toBeNull(); // implicit 200
  });
});
