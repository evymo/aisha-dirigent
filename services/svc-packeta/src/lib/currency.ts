/**
 * Base-currency resolver.
 *
 * The instance base fiat currency is DATA, not a baked literal: it lives in
 * `system_config.commerce_base_currency` and is exposed by the SECURITY DEFINER
 * `public.commerce_base_currency()` RPC (fail-loud when unset). Callers use this
 * only as the last-resort fallback when an upstream row (carrier / shipping quote)
 * carries no explicit currency of its own.
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
