/**
 * Base-currency resolver.
 *
 * The instance base fiat currency is DATA, not a baked literal: it lives in
 * `system_config.commerce_base_currency` and is exposed by the SECURITY DEFINER
 * `public.commerce_base_currency()` RPC (fail-loud when unset). A fork transacting
 * in another currency reads its own configured value instead of a baked fiat literal.
 *
 * Callers use this only as the last-resort fallback when a row (order / package)
 * carries no explicit `currency` of its own — the row value always wins.
 */
import { rpcService } from '../postgrest.js';

let cached: string | undefined;

/** Resolve the configured instance base currency (uppercased). Cached per process. */
export async function resolveBaseCurrency(): Promise<string> {
  if (cached) return cached;
  const value = await rpcService<string>('commerce_base_currency');
  const code = String(value ?? '').trim().toUpperCase();
  if (!code) {
    throw new Error('commerce_base_currency is not configured');
  }
  cached = code;
  return code;
}
