/**
 * Gateway JWT revocation wiring — Phase 12 WP 3.5 integration (OBS-01).
 *
 * The `@aisha/cache-redis` package ships the revocation primitives; this module
 * is the gateway-side glue that binds them to a Redis client on DB 2 (the JWT
 * revocation set, per §-1.12 R2 — keys `aisha:revoked:<jti>`).
 *
 * FAIL-OPEN by construction:
 *   - `AISHA_SHARED_REDIS_DISABLED=true` (or a construction error) → the client
 *     is `null`, and both `isJwtRevoked` / `revokeJwt` become permissive no-ops.
 *   - A Redis outage makes `isJwtRevoked` return `false` (see cache-redis) so a
 *     transient failure never locks every user out.
 *
 * The client uses `lazyConnect: true`, so importing this module does NOT open a
 * socket — the connection is established on first command only.
 */
import { createNamespacedRedis } from '@aisha/cache-redis/client';
import { isJwtRevoked, revokeJwt } from '@aisha/cache-redis/revocation';

// `Redis | null` — reuse the package's return type instead of importing ioredis
// directly (it is a transitive dep of @aisha/cache-redis, not a gateway dep).
type RevocationClient = ReturnType<typeof createNamespacedRedis>;

// Lazily constructed singleton. `undefined` = not yet built; `null` = disabled
// or unbuildable (both fail-open). One connection is shared across requests.
let client: RevocationClient | undefined;

function revocationRedis(): RevocationClient {
  if (client === undefined) {
    try {
      client = createNamespacedRedis({ db: 2, connectionName: 'gateway-revocation' });
    } catch {
      // Misconfigured Redis must not take the gateway down — fail open.
      client = null;
    }
  }
  return client;
}

/**
 * Revocation CHECK for the request/translate path. Returns `true` ONLY when the
 * jti is confirmed revoked; fail-open (`false`) when Redis is disabled, absent,
 * or erroring — so a Redis hiccup never locks users out.
 */
export async function isTokenRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  return isJwtRevoked(revocationRedis(), jti);
}

/**
 * Add a token's jti to the revocation set. `ttlSec` is the token's remaining
 * lifetime; `revokeJwt` caps it at 86400s and self-expires the key so revoked
 * entries never outlive the JWT they shadow.
 */
export async function revokeToken(jti: string, ttlSec: number): Promise<boolean> {
  return revokeJwt(revocationRedis(), jti, ttlSec);
}
