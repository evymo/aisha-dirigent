import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { verifyToken, AuthError } from '../auth.js';
import { createStripeClient } from '../lib/stripe-client.js';
import { rpcUser, rpcService } from '../postgrest.js';
import { resolveBaseCurrency } from '../lib/currency.js';

import { createSafeLogger } from '@aisha/security';
// Same fix as routes/webhook.ts — see comment there. Two `const log` decls
// don't compile under strict TS; renamed underlying logger to safeLog and
// kept the wrapper `log()` so call sites elsewhere in this file work.
const safeLog = createSafeLogger('svc-stripe');
const log = (step: string, details?: Record<string, unknown>): void => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  safeLog.safeInfo(`[SUBSCRIPTION-CHECKOUT] ${step}${d}`);
};

interface SubscriptionCheckoutRequest {
  packageId: string;
  paymentType: 'one_time' | 'recurring';
  subscriptionId?: string;
  currency?: string;
  locale?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export async function subscriptionCheckoutRoute(app: FastifyInstance): Promise<void> {
  app.post('/subscription-checkout', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifyToken(req.headers.authorization);
      const jwt = (req.headers.authorization as string).slice(7);

      const stripe = await createStripeClient();
      if (!stripe) {
        return reply.status(500).send({ error: 'Stripe not configured' });
      }

      const { packageId, paymentType, subscriptionId, currency, locale, successUrl, cancelUrl } =
        req.body as SubscriptionCheckoutRequest;

      log('Request parsed', { packageId, paymentType, subscriptionId, currency });

      if (!packageId || !paymentType) {
        return reply.status(400).send({ error: 'Package ID and payment type are required' });
      }

      // Fetch package
      const pkgResult = await rpcService<{ row?: SubscriptionPackage | null } | null>('edge_subscriptions', {
        p_action: 'get_package_by_id',
        p_payload: { package_id: packageId },
      });
      const pkg = pkgResult?.row ?? null;

      if (!pkg) {
        return reply.status(404).send({ error: 'Subscription package not found' });
      }

      log('Package found', { name: pkg.name, tier: pkg.tier });

      let checkoutPaymentType: 'one_time' | 'recurring' = paymentType;
      let existingSubscription: ExistingSubscription | null = null;

      if (subscriptionId) {
        const existingResult = await rpcUser<{ rows?: ExistingSubscription[] } | null>('edge_subscriptions', {
          p_action: 'get_user_subscriptions',
          p_payload: { user_id: user.userId, statuses: ['approved', 'pending_payment'] },
        }, jwt);

        existingSubscription = (existingResult?.rows ?? []).find((s) => s.id === subscriptionId) ?? null;
        if (!existingSubscription) {
          return reply.status(404).send({ error: 'Approved subscription request not found' });
        }
        if (existingSubscription.package_id !== pkg.id) {
          return reply.status(400).send({ error: 'Subscription package mismatch' });
        }
        checkoutPaymentType = existingSubscription.payment_type;
      }

      // Validate payment type allowed
      if (checkoutPaymentType === 'one_time' && !pkg.allow_one_time_payment) {
        return reply.status(400).send({ error: 'One-time payment not allowed for this package' });
      }
      if (checkoutPaymentType === 'recurring' && !pkg.allow_recurring_payment) {
        return reply.status(400).send({ error: 'Recurring payment not allowed for this package' });
      }

      // Get or create Stripe customer
      const profileResult = await rpcUser<{ row?: { stripe_customer_id?: string | null; email?: string | null; first_name?: string | null; last_name?: string | null } | null } | null>(
        'edge_profiles',
        { p_action: 'get_user_profile', p_payload: { user_id: user.userId } },
        jwt,
      );
      const profile = profileResult?.row ?? null;

      let stripeCustomerId: string;
      if (profile?.stripe_customer_id) {
        stripeCustomerId = profile.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: user.email,
          name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || undefined : undefined,
          metadata: { supabase_user_id: user.userId },
        });
        stripeCustomerId = customer.id;

        await rpcUser('edge_profiles', {
          p_action: 'set_stripe_customer',
          p_payload: { stripe_customer_id: stripeCustomerId, user_id: user.userId },
        }, jwt);
      }

      const packageCurrency = (pkg.currency || (await resolveBaseCurrency())).toUpperCase();
      const targetCurrency = (currency || packageCurrency).toUpperCase();

      // Determine Stripe price
      let stripePriceId = targetCurrency === packageCurrency
        ? (checkoutPaymentType === 'recurring'
          ? (pkg.stripe_price_id_recurring || pkg.stripe_price_id)
          : (pkg.stripe_price_id_one_time || pkg.stripe_price_id))
        : null;

      if (!stripePriceId) {
        log('Creating dynamic Stripe price');

        let stripeProductId = pkg.stripe_product_id;
        if (!stripeProductId) {
          const product = await stripe.products.create({
            name: pkg.name,
            description: pkg.description || `${pkg.tier} subscription - ${pkg.period}`,
            metadata: { supabase_package_id: pkg.id, tier: pkg.tier, period: pkg.period },
          });
          stripeProductId = product.id;

          await rpcService('edge_subscriptions', {
            p_action: 'update_package_stripe',
            p_payload: { package_id: pkg.id, stripe_product_id: stripeProductId },
          });
        }

        // Convert currency if needed
        let amount = pkg.price;
        if (targetCurrency !== packageCurrency) {
          const converted = await rpcService<number | null>('convert_currency_amount', {
            p_amount: pkg.price,
            p_from_currency: packageCurrency,
            p_to_currency: targetCurrency,
          });
          if (typeof converted === 'number') amount = converted;
        }

        if (checkoutPaymentType === 'recurring') {
          const billingIntervalMonths = pkg.billing_interval_months || 1;
          const periodMonths = pkg.period === 'monthly' ? 1 : pkg.period === 'quarterly' ? 3 : 12;
          const recurringAmount = Math.round((amount / periodMonths) * billingIntervalMonths * 100);

          const price = await stripe.prices.create({
            product: stripeProductId,
            unit_amount: recurringAmount,
            currency: targetCurrency.toLowerCase(),
            recurring: { interval: 'month', interval_count: billingIntervalMonths },
            metadata: { supabase_package_id: pkg.id, payment_type: 'recurring', currency: targetCurrency },
          });
          stripePriceId = price.id;

          if (targetCurrency === packageCurrency) {
            await rpcService('edge_subscriptions', {
              p_action: 'update_package_stripe',
              p_payload: { package_id: pkg.id, stripe_price_id_recurring: stripePriceId },
            });
          }
        } else {
          const price = await stripe.prices.create({
            product: stripeProductId,
            unit_amount: Math.round(amount * 100),
            currency: targetCurrency.toLowerCase(),
            metadata: { supabase_package_id: pkg.id, payment_type: 'one_time', currency: targetCurrency },
          });
          stripePriceId = price.id;

          if (targetCurrency === packageCurrency) {
            await rpcService('edge_subscriptions', {
              p_action: 'update_package_stripe',
              p_payload: { package_id: pkg.id, stripe_price_id_one_time: stripePriceId },
            });
          }
        }
      }

      // Calculate subscription period
      const now = new Date();
      const periodEnd = new Date(now);
      switch (pkg.period) {
        case 'monthly': periodEnd.setMonth(periodEnd.getMonth() + 1); break;
        case 'quarterly': periodEnd.setMonth(periodEnd.getMonth() + 3); break;
        case 'annual': periodEnd.setFullYear(periodEnd.getFullYear() + 1); break;
      }

      // Calculate amount for records
      let recordAmount = pkg.price;
      if (targetCurrency !== packageCurrency) {
        const converted = await rpcService<number | null>('convert_currency_amount', {
          p_amount: pkg.price,
          p_from_currency: packageCurrency,
          p_to_currency: targetCurrency,
        });
        if (typeof converted === 'number') recordAmount = converted;
      }

      let subscription = existingSubscription ? { id: existingSubscription.id } : null;

      if (existingSubscription) {
        if (existingSubscription.status === 'approved') {
          await rpcService('edge_subscriptions', {
            p_action: 'update_subscription',
            p_payload: { id: existingSubscription.id, status: 'pending_payment' },
          });
        }
      } else {
        const subResult = await rpcService<{ id?: string } | null>('edge_subscriptions', {
          p_action: 'create_member_subscription',
          p_payload: {
            amount_paid: recordAmount,
            billing_interval_months: pkg.billing_interval_months || 1,
            currency: targetCurrency,
            package_id: pkg.id,
            payment_type: checkoutPaymentType,
            period_end: periodEnd.toISOString(),
            period_start: now.toISOString(),
            status: 'pending_payment',
            user_id: user.userId,
          },
        });

        subscription = subResult?.id ? { id: subResult.id } : null;
        if (!subscription) {
          return reply.status(500).send({ error: 'Failed to create subscription record' });
        }
      }

      if (!subscription) {
        return reply.status(500).send({ error: 'Subscription checkout preparation failed' });
      }

      const origin = (req.headers.origin as string) || 'https://web.platform.com';

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: stripeCustomerId,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        mode: checkoutPaymentType === 'recurring' ? 'subscription' : 'payment',
        success_url: successUrl || `${origin}/member/subscription?success=true&subscription_id=${subscription.id}`,
        cancel_url: cancelUrl || `${origin}/subscription?cancelled=true`,
        metadata: {
          subscription_id: subscription.id,
          package_id: pkg.id,
          user_id: user.userId,
          payment_type: checkoutPaymentType,
          currency: targetCurrency,
        },
        locale: (locale || 'auto') as Stripe.Checkout.SessionCreateParams.Locale,
        payment_method_types: ['card'],
      };

      if (checkoutPaymentType === 'recurring') {
        sessionParams.subscription_data = {
          metadata: {
            subscription_id: subscription.id,
            package_id: pkg.id,
            user_id: user.userId,
            currency: targetCurrency,
          },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      log('Created checkout session', { sessionId: session.id });

      // Record payment session
      await rpcService('edge_payment_sessions', {
        p_action: 'insert',
        p_payload: {
          amount: recordAmount,
          currency: targetCurrency,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          metadata: { currency: targetCurrency, package_id: pkg.id, package_name: pkg.name, payment_type: checkoutPaymentType },
          reference_id: subscription.id,
          reference_type: 'subscription',
          session_type: 'subscription_checkout',
          status: 'pending',
          stripe_session_id: session.id,
          user_id: user.userId,
        },
      });

      return reply.send({ sessionId: session.id, url: session.url, subscriptionId: subscription.id });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
}

interface SubscriptionPackage {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  tier: string;
  period: string;
  price: number;
  currency: string | null;
  is_recurring: boolean | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_id_one_time: string | null;
  stripe_price_id_recurring: string | null;
  min_billing_months: number | null;
  billing_interval_months: number | null;
  allow_one_time_payment: boolean | null;
  allow_recurring_payment: boolean | null;
  governance_tokens: number | null;
  impact_tokens: number | null;
}

interface ExistingSubscription {
  id: string;
  package_id: string;
  payment_type: 'one_time' | 'recurring';
  status: string;
}
