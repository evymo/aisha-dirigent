import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, AuthError } from '../auth.js';
import { createStripeClient } from '../lib/stripe-client.js';
import { rpcUser } from '../postgrest.js';

export async function customerPortalRoute(app: FastifyInstance): Promise<void> {
  app.post('/customer-portal', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await verifyToken(req.headers.authorization);
      const jwt = (req.headers.authorization as string).slice(7);

      const stripe = await createStripeClient();
      if (!stripe) {
        return reply.status(500).send({ error: 'Stripe not configured' });
      }

      const profileResult = await rpcUser<{ row?: { stripe_customer_id?: string | null } | null } | null>(
        'edge_profiles',
        { p_action: 'get_user_profile', p_payload: { user_id: user.userId } },
        jwt,
      );
      const profile = profileResult?.row ?? null;

      if (!profile?.stripe_customer_id) {
        return reply.status(404).send({ error: 'No Stripe customer found. Please make a purchase first.' });
      }

      const origin = (req.headers.origin as string) || 'https://web.platform.com';

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${origin}/member/subscription`,
      });

      return reply.send({ url: portalSession.url });
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
}
