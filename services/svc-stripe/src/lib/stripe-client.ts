import Stripe from 'stripe';
import { config } from '../config.js';
import { rpcService } from '../postgrest.js';

let cachedStripeKey: string | null = null;

/**
 * Get Stripe secret key from DB (edge_app_secrets) with env fallback.
 */
export async function getStripeSecretKey(): Promise<string | null> {
  if (cachedStripeKey) return cachedStripeKey;

  try {
    const result = await rpcService<{ value?: string } | null>('edge_app_secrets', {
      p_action: 'get',
      p_payload: { key: 'STRIPE_SECRET_KEY' },
    });
    if (result?.value) {
      cachedStripeKey = result.value;
      return cachedStripeKey;
    }
  } catch {
    // Fall through to env
  }

  const envKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (envKey) {
    cachedStripeKey = envKey;
    return cachedStripeKey;
  }

  return null;
}

/**
 * Create a Stripe client instance.
 */
export async function createStripeClient(): Promise<Stripe | null> {
  const key = await getStripeSecretKey();
  if (!key) return null;

  return new Stripe(key, {
    // config.stripeApiVersion pins a newer Stripe API version ('2025-08-27.basil')
    // than the stripe@17 SDK's typed default ('2025-02-24.acacia'). The version is
    // valid at runtime (Stripe honours the version string in the request), so cast
    // to satisfy the SDK's apiVersion literal type without changing runtime behaviour.
    apiVersion: config.stripeApiVersion as unknown as Stripe.LatestApiVersion,
  });
}

/**
 * Clear cached key (useful if key rotation occurs).
 */
export function clearStripeKeyCache(): void {
  cachedStripeKey = null;
}
