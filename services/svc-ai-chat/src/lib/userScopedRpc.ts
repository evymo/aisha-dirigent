/**
 * User-scoped PostgREST identity threading (RFC 8693 on-behalf-of mediation).
 *
 * WHY MINT instead of forwarding the caller's bearer token:
 *   - The caller authenticates with a Keycloak RS256 access token (validated by
 *     auth.ts verifyToken against the KC JWKS). PostgREST does NOT validate that
 *     token — it is configured with the symmetric HS256 `PGRST_JWT_SECRET`
 *     (docker-compose.coolify.yml), so a raw KC token forwarded to PostgREST is
 *     rejected.
 *   - The shared service_role token has NO `sub` claim, so `auth.uid()` resolves
 *     to NULL inside SECURITY DEFINER RPCs → wrong tenancy, broken audit
 *     attribution, and definer bodies that gate on auth.uid() either RAISE
 *     ('Not authenticated') or skip their ownership checks (service_role branch).
 *
 * So, AFTER the service has verified the caller against Keycloak, this module
 * mints a SHORT-LIVED HS256 token that carries the VERIFIED identity:
 *   sub  = verified user id → auth.uid() (aisha_auth.uid() maps a KC sub through
 *          aisha_auth.identities, or accepts it directly when it is the user uuid)
 *   role = 'authenticated'  → NEVER service_role (least privilege)
 * signed with the same secret PostgREST validates (config.postgrestJwtSecret =
 * JWT_SECRET = PGRST_JWT_SECRET). This is the exact mediation pattern the Omni
 * /v1 lane already uses for MCP tool dispatch (lib/mcpToolProxy.mintMcpUserToken,
 * which delegates to this module) and the gateway uses for /rest/v1
 * (services/gateway/src/auth/postgrest-jwt.ts).
 *
 * FAIL-LOUD CONTRACT: minting THROWS when the signing secret or the user id is
 * missing. A user-scoped RPC path must never silently degrade to service_role —
 * callers translate the throw into an explicit 5xx, not a fallback.
 *
 * @module
 */
import { createHmac } from 'node:crypto';

import { config } from '../config.js';
import { createUserRpcAdapter, type PostgrestClient } from './rpcAdapter.js';

const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Default lifetime of a minted on-behalf-of token: bounds the compromise window. */
const DEFAULT_TTL_SECONDS = 15 * 60;

export interface MintUserScopedTokenInput {
  /** Verified caller identity — becomes `sub` (→ auth.uid()). REQUIRED. */
  userId: string;
  /** Optional story binding claim (used by the MCP mediation lane). */
  storyId?: string | null;
  /** Audit tag naming the mediation lane, e.g. 'omni-mcp-mediation', 'chat-user-rpc'. */
  tokenUse: string;
  /** Override lifetime in seconds (default 900). */
  ttlSeconds?: number;
}

/**
 * Mint a short-lived USER-scoped HS256 JWT accepted by PostgREST (and every
 * service validating with the shared JWT_SECRET). Throws — never falls back —
 * when the secret or the user id is missing.
 */
export function mintUserScopedPostgrestToken(input: MintUserScopedTokenInput): string {
  if (!config.postgrestJwtSecret) {
    throw new Error(
      'user-scoped token minting impossible: JWT_SECRET/POSTGREST_JWT_SECRET is not configured ' +
      '(refusing to substitute service_role on a user-scoped path)',
    );
  }
  if (!input.userId) {
    throw new Error('user-scoped token minting impossible: no verified user id');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: input.userId,
    role: 'authenticated', // load-bearing: RPCs run under RLS/definer auth.uid(), never service_role
    story_id: input.storyId ?? null,
    iat: now,
    exp: now + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    token_use: input.tokenUse,
  };
  const data = `${b64url(header)}.${b64url(payload)}`;
  const sig = createHmac('sha256', config.postgrestJwtSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * PostgREST RPC adapter bound to the VERIFIED caller identity: every `.rpc()`
 * goes out with a freshly-minted user-scoped token, so `auth.uid()` inside
 * SECURITY DEFINER functions resolves to the real caller. Throws (fail-loud)
 * when minting is impossible — see {@link mintUserScopedPostgrestToken}.
 */
export function createUserScopedRpcAdapter(userId: string, tokenUse: string): PostgrestClient {
  const token = mintUserScopedPostgrestToken({ userId, tokenUse });
  return createUserRpcAdapter(token);
}
