import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { verifyToken, AuthError } from '../auth.js';
import { createStripeClient } from '../lib/stripe-client.js';
import { rpcService, rpcUser } from '../postgrest.js';
import { resolveBaseCurrency } from '../lib/currency.js';

export async function checkoutRoute(app: FastifyInstance): Promise<void> {
  app.post('/checkout', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifyToken(req.headers.authorization);
      const jwt = (req.headers.authorization as string).slice(7);

      const stripe = await createStripeClient();
      if (!stripe) {
        return reply.status(500).send({ error: 'Stripe not configured' });
      }

      const { orderId, locale, successUrl, cancelUrl } = req.body as {
        orderId: string;
        locale?: string;
        successUrl?: string;
        cancelUrl?: string;
      };

      if (!orderId) {
        return reply.status(400).send({ error: 'Order ID is required' });
      }

      // Fetch order with items
      const orderResult = await rpcUser<{ row?: OrderRow | null } | null>('edge_orders', {
        p_action: 'get_checkout_context',
        p_payload: { order_id: orderId, user_id: user.userId },
      }, jwt);

      const order = orderResult?.row ?? null;
      if (!order) {
        return reply.status(404).send({ error: 'Order not found' });
      }

      if (order.status !== 'pending') {
        return reply.status(400).send({ error: 'Order is not in pending status' });
      }

      // Get or create Stripe customer
      // ⛔ edge_profiles je dispečer SPRÁVY a SLUŽBY — uživatelským tokenem ho člen
      // nezavolá (DB: „Unauthorized“), takže tahle cesta padala každému členovi.
      // user_id pochází z ověřeného tokenu (verifyToken), ne od klienta → službou.
      const profileResult = await rpcService<{ row?: { stripe_customer_id?: string | null; email?: string | null } | null } | null>('edge_profiles',
        { p_action: 'get_user_profile', p_payload: { user_id: user.userId } });
      const profile = profileResult?.row ?? null;

      let stripeCustomerId: string;
      if (profile?.stripe_customer_id) {
        stripeCustomerId = profile.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.userId },
        });
        stripeCustomerId = customer.id;

        await rpcService('edge_profiles', {
          p_action: 'set_stripe_customer',
          p_payload: { stripe_customer_id: stripeCustomerId, user_id: user.userId },
        });
      }

      // Build line items — currency comes from the order; fall back to the
      // instance-configured base currency (never a baked fiat literal).
      const currencyCode = order.currency || (await resolveBaseCurrency());
      const orderCurrency = currencyCode.toLowerCase();
      const lineItems = order.order_items.map((item) => ({
        price_data: {
          currency: orderCurrency,
          product_data: {
            name: item.product?.[0]?.name || 'Product',
            description: item.product?.[0]?.description?.substring(0, 500) || undefined,
          },
          unit_amount: Math.round(item.price_at_purchase * 100),
        },
        quantity: item.quantity,
      }));

      if (order.shipping && Number(order.shipping) > 0) {
        lineItems.push({
          price_data: {
            currency: orderCurrency,
            product_data: { name: 'Shipping', description: undefined },
            unit_amount: Math.round(Number(order.shipping) * 100),
          },
          quantity: 1,
        });
      }

      const origin = (req.headers.origin as string) || 'https://web.platform.com';

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: successUrl || `${origin}/member/orders?success=true&order_id=${orderId}`,
        cancel_url: cancelUrl || `${origin}/checkout?cancelled=true`,
        metadata: {
          order_id: orderId,
          user_id: user.userId,
          currency: currencyCode,
        },
        shipping_address_collection: { allowed_countries: ['CZ', 'SK', 'DE', 'AT', 'PL'] },
        billing_address_collection: 'required',
        // Stripe resolves the checkout UI language from the caller's locale, or
        // auto-detects from the buyer's browser when none is supplied.
        locale: (locale || 'auto') as Stripe.Checkout.SessionCreateParams.Locale,
      });

      // Update order
      // ⛔ update_order zapisuje jen služba (edge_orders); vlastnictví objednávky
      // ověřil výš get_checkout_context uživatelským tokenem.
      await rpcService('edge_orders', {
        p_action: 'update_order',
        p_payload: {
          order_id: orderId,
          status: 'awaiting_payment',
          stripe_payment_intent_id: session.id,
          stripe_session_id: session.id,
        },
      });

      // Record payment session
      await rpcUser('edge_payment_sessions', {
        p_action: 'insert',
        p_payload: {
          amount: order.total,
          currency: currencyCode,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          metadata: { currency: currencyCode, order_id: orderId },
          reference_id: orderId,
          reference_type: 'order',
          session_type: 'order_checkout',
          status: 'pending',
          stripe_session_id: session.id,
          user_id: user.userId,
        },
      }, jwt);

      return reply.send({ sessionId: session.id, url: session.url });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
}

interface OrderRow {
  id: string;
  user_id: string;
  total: number;
  shipping: number | null;
  currency: string | null;
  status: string;
  shipping_address: Record<string, unknown> | null;
  order_items: Array<{
    id: string;
    product_id: string;
    quantity: number;
    price_at_purchase: number;
    product: Array<{ name: string; description: string | null }> | null;
  }>;
}
