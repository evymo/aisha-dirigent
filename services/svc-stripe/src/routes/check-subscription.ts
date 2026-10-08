import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, AuthError } from '../auth.js';
import { createStripeClient } from '../lib/stripe-client.js';
import { rpcService, rpcUser } from '../postgrest.js';

export async function checkSubscriptionRoute(app: FastifyInstance): Promise<void> {
  app.post('/check-subscription', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifyToken(req.headers.authorization);
      const jwt = (req.headers.authorization as string).slice(7);

      const stripe = await createStripeClient();
      if (!stripe) {
        return reply.status(500).send({ error: 'Stripe not configured' });
      }

      // Get user subscriptions from DB
      const subsResult = await rpcUser<{ rows?: SubscriptionRow[] } | null>('edge_subscriptions', {
        p_action: 'get_user_subscriptions',
        p_payload: { statuses: ['active', 'pending_payment', 'approved'], user_id: user.userId },
      }, jwt);
      const subscriptions = subsResult?.rows ?? [];

      // Get Stripe customer
      // ⛔ edge_profiles je dispečer SPRÁVY a SLUŽBY — uživatelským tokenem ho člen
      // nezavolá (DB: „Unauthorized“), takže tahle cesta padala každému členovi.
      // user_id pochází z ověřeného tokenu (verifyToken), ne od klienta → službou.
      const profileResult = await rpcService<{ row?: { stripe_customer_id?: string | null } | null } | null>('edge_profiles',
        { p_action: 'get_user_profile', p_payload: { user_id: user.userId } });
      const profile = profileResult?.row ?? null;

      // Sync with Stripe
      if (profile?.stripe_customer_id) {
        try {
          const stripeSubList = await stripe.subscriptions.list({
            customer: profile.stripe_customer_id,
            status: 'active',
            limit: 10,
          });

          for (const stripeSub of stripeSubList.data) {
            const dbSubId = stripeSub.metadata?.subscription_id;
            if (dbSubId) {
              const dbSub = subscriptions.find((s) => s.id === dbSubId);
              if (dbSub && dbSub.status !== 'active') {
                // Aktivaci zapisuje SLUŽBA: stav potvrdil Stripe a dbSub pochází
                // z předplatných TOHOTO uživatele (čtených jeho tokenem výš).
                // Uživatelský token zápis nesmí (edge_subscriptions, 2026-10-06) —
                // jinak by si předplatné aktivoval kdokoli přímým RPC.
                await rpcService('edge_subscriptions', {
                  p_action: 'update_subscription',
                  p_payload: {
                    cancel_at_period_end: stripeSub.cancel_at_period_end,
                    id: dbSubId,
                    new_stripe_subscription_id: stripeSub.id,
                    next_billing_date: new Date(stripeSub.current_period_end * 1000).toISOString(),
                    status: 'active',
                  },
                });
                // Odpověď nese stav PO synchronizaci — jinak by klient až do
                // dalšího volání viděl předplatné, které právě aktivoval, jako neaktivní.
                dbSub.status = 'active';
              }
            }
          }
        } catch {
          // Non-fatal — continue with DB data
        }
      }

      const activeSubscription = subscriptions.find((s) => s.status === 'active');
      const pendingSubscription = subscriptions.find((s) => s.status === 'pending_payment' || s.status === 'approved');

      return reply.send({
        hasActiveSubscription: !!activeSubscription,
        activeSubscription: activeSubscription ? {
          id: activeSubscription.id,
          status: activeSubscription.status,
          paymentType: activeSubscription.payment_type,
          periodStart: activeSubscription.period_start,
          periodEnd: activeSubscription.period_end,
          nextBillingDate: activeSubscription.next_billing_date,
          cancelAtPeriodEnd: activeSubscription.cancel_at_period_end,
          package: activeSubscription.package,
        } : null,
        pendingSubscription: pendingSubscription ? {
          id: pendingSubscription.id,
          status: pendingSubscription.status,
          package: pendingSubscription.package,
        } : null,
        stripeCustomerId: profile?.stripe_customer_id || null,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
}

interface SubscriptionRow {
  id: string;
  status: string;
  payment_type?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  next_billing_date?: string | null;
  cancel_at_period_end?: boolean | null;
  stripe_subscription_id?: string | null;
  package?: {
    name?: string | null;
    tier?: string | null;
    period?: string | null;
    governance_tokens?: number | null;
    impact_tokens?: number | null;
  } | null;
}
