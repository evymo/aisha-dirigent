/**
 * Shared plumbing for the Money S5 source adapters (delivery notes, invoices, …).
 * The auth/endpoint/credential handling is identical across document kinds — only
 * the GraphQL query + mapping differ — so it lives here once.
 */
import type { SourceConnection, MemberTier } from '@aisha/audience-types';
import { MoneyS5Client, type MoneyCredentials } from './money-s5-client.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve OAuth2 credentials from the per-read SourceConnection. `authSecretRef`
 * is an opaque reference (env-var-name scheme): the named env var holds
 * `clientId:clientSecret`. The secret never lives in this package, in the source
 * declaration, or in the story spine — only the reference does.
 *
 * This is also the seam for "one URL, many accounting entities (agendy)": each
 * agenda is a distinct OAuth2 client, so a distinct `authSecretRef` (a distinct
 * per-agenda story binding) selects it — the endpoint URL can be shared.
 */
export function resolveCredentials(connection: SourceConnection, slug: string): MoneyCredentials {
  const ref = connection.authSecretRef;
  if (!ref) throw new Error(`money-s5: connection has no authSecretRef for '${slug}'`);
  const raw = process.env[ref];
  if (!raw) throw new Error(`money-s5: secret ref env '${ref}' is empty`);
  const idx = raw.indexOf(':');
  if (idx < 0) throw new Error(`money-s5: secret must be 'clientId:clientSecret' (env '${ref}')`);
  return { clientId: raw.slice(0, idx), clientSecret: raw.slice(idx + 1) };
}

export function clientFor(
  connection: SourceConnection,
  slug: string,
  fetchImpl?: typeof fetch,
): MoneyS5Client {
  return new MoneyS5Client({
    baseUrl: connection.endpointUrl,
    credentials: resolveCredentials(connection, slug),
    fetchImpl,
  });
}

/** Caller scope stamped on a successful operator source read. */
export function operatorScope(callerContext: { userId: string; tier: MemberTier }) {
  return {
    userId: callerContext.userId,
    tier: callerContext.tier,
    allowedReason: 'operator_source_read',
  };
}
