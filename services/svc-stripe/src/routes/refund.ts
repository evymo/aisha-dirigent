import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, AuthError, isAdminOrStaff } from '../auth.js';
import { createStripeClient } from '../lib/stripe-client.js';
import { rpcService } from '../postgrest.js';

/**
 * POST /refund — admin/staff-gated Stripe refund.
 *
 * Client contract (web `useAdminPayments.processRefund` → gateway fn
 * `stripe-refund`): JSON body `{ paymentIntentId: string, amount?: number }`
 * where `amount` is in the smallest currency unit and, when omitted, refunds
 * the full charge. Responds `{ refundId, status }`.
 *
 * Refunds move money, so this is a privileged action: the caller must present
 * a valid token AND carry the `admin` or `staff` realm role. We reuse the same
 * Stripe client init + error handling as sibling routes (checkout.ts) and audit
 * every refund via `record_audit_log` (same RPC the webhook route uses).
 */
export async function refundRoute(app: FastifyInstance): Promise<void> {
  app.post('/refund', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifyToken(req.headers.authorization);

      // Privileged action — least privilege: only admin/staff may refund.
      if (!isAdminOrStaff(user)) {
        return reply.status(403).send({ error: 'Forbidden: admin or staff role required' });
      }

      const { paymentIntentId, amount } = (req.body ?? {}) as {
        paymentIntentId?: unknown;
        amount?: unknown;
      };

      if (typeof paymentIntentId !== 'string' || paymentIntentId.length === 0) {
        return reply.status(400).send({ error: 'paymentIntentId is required' });
      }

      // amount is optional (omitted => full refund). When present it must be a
      // positive integer in the smallest currency unit.
      let refundAmount: number | undefined;
      if (amount !== undefined && amount !== null) {
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
          return reply
            .status(400)
            .send({ error: 'amount must be a positive integer in the smallest currency unit' });
        }
        refundAmount = amount;
      }

      const stripe = await createStripeClient();
      if (!stripe) {
        return reply.status(500).send({ error: 'Stripe not configured' });
      }

      // Idempotency: a stable key derived from the logical refund (payment
      // intent + amount) so a retry / double-submit of the SAME refund is
      // deduped by Stripe instead of issuing a second, duplicate refund.
      const idempotencyKey = `refund:${paymentIntentId}:${refundAmount ?? 'full'}`;

      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          ...(refundAmount !== undefined ? { amount: refundAmount } : {}),
        },
        { idempotencyKey },
      );

      // Audit the privileged action. Non-fatal: a bookkeeping failure must not
      // hide the fact that the refund already succeeded at Stripe.
      try {
        await rpcService('record_audit_log', {
          p_action: 'payment.refunded',
          p_details: {
            stripe_refund_id: refund.id,
            stripe_payment_intent_id: paymentIntentId,
            amount: refundAmount ?? null,
            status: refund.status,
          },
          p_resource_id: paymentIntentId,
          p_resource_type: 'refund',
          p_user_id: user.userId,
        });
      } catch (auditErr) {
        req.log.error({ err: auditErr }, 'refund audit log failed');
      }

      return reply.send({ refundId: refund.id, status: refund.status ?? 'unknown' });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      // Map Stripe SDK errors to a clean JSON error. Stripe errors carry a
      // numeric `statusCode` (e.g. 400 invalid_request, 402 card_error,
      // 404 resource_missing); anything else is an unexpected 500.
      const maybeStripe = err as { statusCode?: unknown; message?: unknown; type?: unknown };
      if (
        typeof maybeStripe?.statusCode === 'number' &&
        typeof maybeStripe?.type === 'string' &&
        maybeStripe.type.startsWith('Stripe')
      ) {
        const status = maybeStripe.statusCode >= 400 && maybeStripe.statusCode < 600
          ? maybeStripe.statusCode
          : 500;
        return reply.status(status).send({
          error: typeof maybeStripe.message === 'string' ? maybeStripe.message : 'Refund failed',
        });
      }
      req.log.error({ err }, 'refund failed');
      return reply.status(500).send({ error: 'Refund failed' });
    }
  });
}
