import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { config } from '../config.js';
import { createStripeClient } from '../lib/stripe-client.js';
import { rpcService } from '../postgrest.js';

import { createSafeLogger } from '@aisha/security';
// safeLog = real @aisha/security logger; `log()` is a thin wrapper that
// prepends [STRIPE-WEBHOOK] for grep-ability. The previous version had
// `const log = createSafeLogger(...)` AND a second `const log = (...) => ...`,
// which is a TS2451 redeclaration — would block compilation. Renamed
// the underlying logger to safeLog so the call-site signature stays the
// same and existing log('step', { details }) calls keep working.
const safeLog = createSafeLogger('svc-stripe');
const log = (step: string, details?: Record<string, unknown>): void => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  safeLog.safeInfo(`[STRIPE-WEBHOOK] ${step}${d}`);
};

export async function webhookRoute(app: FastifyInstance): Promise<void> {
  app.post('/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['stripe-signature'] as string | undefined;
    if (!signature) {
      return reply.status(400).send({ error: 'Missing signature' });
    }

    const stripe = await createStripeClient();
    if (!stripe) {
      return reply.status(500).send({ error: 'Stripe not configured' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody as string,
        signature,
        config.stripeWebhookSecret,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      return reply.status(400).send({ error: `Webhook signature verification failed: ${msg}` });
    }

    log('Event received', { type: event.type });

    switch (event.type) {
      // ========== ORDER EVENTS ==========
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        const subscriptionId = session.metadata?.subscription_id;
        const userId = session.metadata?.user_id;
        const paymentType = session.metadata?.payment_type;

        log('Checkout completed', { orderId, subscriptionId, paymentType });

        await rpcService('edge_payment_sessions', {
          p_action: 'update_status',
          p_payload: {
            completed_at: new Date().toISOString(),
            status: 'completed',
            stripe_session_id: session.id,
          },
        });

        if (orderId) {
          await rpcService('edge_orders', {
            p_action: 'update_order',
            p_payload: {
              order_id: orderId,
              status: 'paid',
              stripe_payment_intent_id: session.payment_intent as string,
            },
          });

          await rpcService('record_audit_log', {
            p_action: 'order.payment_completed',
            p_details: {
              stripe_session_id: session.id,
              payment_intent: session.payment_intent,
              amount_total: session.amount_total,
              currency: session.currency,
            },
            p_resource_id: orderId,
            p_resource_type: 'order',
            p_user_id: userId,
          });
        }

        if (subscriptionId && paymentType === 'one_time') {
          await rpcService('edge_subscriptions', {
            p_action: 'update_subscription',
            p_payload: {
              id: subscriptionId,
              status: 'active',
              stripe_payment_intent_id: session.payment_intent as string,
            },
          });
          log('One-time subscription activated', { subscriptionId });
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        const subscriptionId = session.metadata?.subscription_id;

        log('Checkout expired', { orderId, subscriptionId });

        await rpcService('edge_payment_sessions', {
          p_action: 'update_status',
          p_payload: { status: 'expired', stripe_session_id: session.id },
        });

        if (orderId) {
          await rpcService('edge_orders', {
            p_action: 'update_order',
            p_payload: { order_id: orderId, status: 'payment_expired' },
          });
        }

        if (subscriptionId) {
          await rpcService('edge_subscriptions', {
            p_action: 'update_subscription',
            p_payload: { id: subscriptionId, status: 'payment_expired' },
          });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const orderId = pi.metadata?.order_id;
        const subscriptionId = pi.metadata?.subscription_id;

        log('Payment failed', { orderId, subscriptionId });

        if (orderId) {
          await rpcService('edge_orders', {
            p_action: 'update_order',
            p_payload: { order_id: orderId, status: 'payment_failed' },
          });
        }
        if (subscriptionId) {
          await rpcService('edge_subscriptions', {
            p_action: 'update_subscription',
            p_payload: { id: subscriptionId, status: 'payment_failed' },
          });
        }
        break;
      }

      // ========== SUBSCRIPTION EVENTS ==========
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const subscriptionId = sub.metadata?.subscription_id;

        log('Stripe subscription created', { stripeSubId: sub.id, subscriptionId, status: sub.status });

        if (subscriptionId) {
          await rpcService('edge_subscriptions', {
            p_action: 'update_subscription',
            p_payload: {
              id: subscriptionId,
              new_stripe_subscription_id: sub.id,
              next_billing_date: new Date(sub.current_period_end * 1000).toISOString(),
              status: sub.status === 'active' ? 'active' : 'pending_payment',
            },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const subscriptionId = sub.metadata?.subscription_id;

        log('Subscription updated', { stripeSubId: sub.id, subscriptionId, status: sub.status });

        let dbStatus = 'active';
        if (sub.status === 'canceled') dbStatus = 'cancelled';
        else if (sub.status === 'past_due') dbStatus = 'past_due';
        else if (sub.status === 'unpaid') dbStatus = 'unpaid';

        const payload: Record<string, unknown> = {
          cancel_at_period_end: sub.cancel_at_period_end,
          next_billing_date: new Date(sub.current_period_end * 1000).toISOString(),
          status: dbStatus,
        };

        if (subscriptionId) {
          payload.id = subscriptionId;
        } else {
          payload.stripe_subscription_id = sub.id;
        }

        await rpcService('edge_subscriptions', {
          p_action: 'update_subscription',
          p_payload: payload,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const subscriptionId = sub.metadata?.subscription_id;

        log('Subscription deleted/cancelled', { stripeSubId: sub.id, subscriptionId });

        const payload: Record<string, unknown> = { status: 'cancelled' };
        if (subscriptionId) {
          payload.id = subscriptionId;
        } else {
          payload.stripe_subscription_id = sub.id;
        }

        await rpcService('edge_subscriptions', {
          p_action: 'update_subscription',
          p_payload: payload,
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeSubId = invoice.subscription as string | null;

        log('Invoice paid', { invoiceId: invoice.id, subscriptionId: stripeSubId, amountPaid: invoice.amount_paid });

        if (stripeSubId) {
          const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
          const subscriptionId = stripeSub.metadata?.subscription_id;

          if (subscriptionId) {
            await rpcService('edge_subscriptions', {
              p_action: 'update_subscription',
              p_payload: {
                id: subscriptionId,
                next_billing_date: new Date(stripeSub.current_period_end * 1000).toISOString(),
                status: 'active',
                stripe_invoice_id: invoice.id,
              },
            });
            log('Subscription activated via invoice', { subscriptionId });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeSubId = invoice.subscription as string | null;

        log('Invoice payment failed', { invoiceId: invoice.id, subscriptionId: stripeSubId });

        if (stripeSubId) {
          await rpcService('edge_subscriptions', {
            p_action: 'update_subscription',
            p_payload: { status: 'past_due', stripe_subscription_id: stripeSubId },
          });
        }
        break;
      }

      // ========== REFUND EVENTS ==========
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        log('Charge refunded', { chargeId: charge.id, refunded: charge.refunded });

        const orderResult = await rpcService<{ order_id?: string | null } | null>('edge_orders', {
          p_action: 'get_order_id_by_payment_intent',
          p_payload: { stripe_payment_intent_id: charge.payment_intent },
        });

        const orderId = orderResult?.order_id;
        if (orderId) {
          await rpcService('edge_orders', {
            p_action: 'update_order',
            p_payload: {
              order_id: orderId,
              status: charge.refunded ? 'refunded' : 'partially_refunded',
            },
          });
        }
        break;
      }

      // ========== DISPUTE EVENTS ==========
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        log('Dispute opened', { disputeId: dispute.id, amount: dispute.amount, reason: dispute.reason });

        const disputeOrderResult = await rpcService<{ order_id?: string | null; user_id?: string | null } | null>(
          'edge_stripe_disputes',
          { p_action: 'find_order_by_payment_intent', p_payload: { stripe_payment_intent_id: dispute.payment_intent as string } },
        );

        await rpcService('edge_stripe_disputes', {
          p_action: 'upsert_dispute',
          p_payload: {
            amount: dispute.amount,
            currency: dispute.currency,
            evidence_due_by: dispute.evidence_details?.due_by
              ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
              : null,
            is_charge_refundable: dispute.is_charge_refundable,
            metadata: {
              network_reason_code: dispute.network_reason_code,
              payment_method_type: dispute.payment_method_details?.type,
            },
            order_id: disputeOrderResult?.order_id ?? null,
            reason: dispute.reason,
            status: dispute.status,
            stripe_charge_id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
            stripe_dispute_id: dispute.id,
            stripe_payment_intent_id: dispute.payment_intent as string,
            user_id: disputeOrderResult?.user_id ?? null,
          },
        });

        if (disputeOrderResult?.order_id) {
          await rpcService('edge_orders', {
            p_action: 'update_order',
            p_payload: { order_id: disputeOrderResult.order_id, status: 'disputed' },
          });
        }

        await rpcService('record_audit_log', {
          p_action: 'dispute.created',
          p_details: {
            amount: dispute.amount,
            currency: dispute.currency,
            evidence_due_by: dispute.evidence_details?.due_by
              ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
              : null,
            reason: dispute.reason,
            stripe_charge_id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
            stripe_dispute_id: dispute.id,
          },
          p_resource_id: disputeOrderResult?.order_id ?? dispute.id,
          p_resource_type: 'dispute',
          p_user_id: disputeOrderResult?.user_id ?? null,
        });
        break;
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        log('Dispute closed', { disputeId: dispute.id, status: dispute.status });

        await rpcService('edge_stripe_disputes', {
          p_action: 'update_status',
          p_payload: {
            closed_at: new Date().toISOString(),
            status: dispute.status,
            stripe_dispute_id: dispute.id,
          },
        });

        const closedOrderResult = await rpcService<{ order_id?: string | null; user_id?: string | null } | null>(
          'edge_stripe_disputes',
          { p_action: 'find_order_by_payment_intent', p_payload: { stripe_payment_intent_id: dispute.payment_intent as string } },
        );

        if (closedOrderResult?.order_id) {
          const newStatus = dispute.status === 'won' ? 'paid' : 'dispute_lost';
          await rpcService('edge_orders', {
            p_action: 'update_order',
            p_payload: { order_id: closedOrderResult.order_id, status: newStatus },
          });
        }

        await rpcService('record_audit_log', {
          p_action: `dispute.${dispute.status}`,
          p_details: { reason: dispute.reason, status: dispute.status, stripe_dispute_id: dispute.id },
          p_resource_id: closedOrderResult?.order_id ?? dispute.id,
          p_resource_type: 'dispute',
          p_user_id: closedOrderResult?.user_id ?? null,
        });
        break;
      }

      default:
        log('Unhandled event type', { type: event.type });
    }

    return reply.send({ received: true });
  });
}
