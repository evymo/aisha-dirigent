/**
 * @aisha/cache-redis — Shared Redis client + named primitives.
 *
 * - `client.ts`     → createNamespacedRedis({ db }) — DB-isolated ioredis client
 * - `revocation.ts` → revokeJwt / isJwtRevoked / areJwtsRevoked (DB 2)
 *
 * Reuses existing shared Redis from docker-compose.coolify-shared-redis.yml per
 * Phase 12 §-1.12 R2 (no new Redis container).
 *
 * Usage (gateway middleware example):
 *   ```ts
 *   import { createNamespacedRedis } from '@aisha/cache-redis/client';
 *   import { isJwtRevoked } from '@aisha/cache-redis/revocation';
 *
 *   const redis = createNamespacedRedis({ db: 2, connectionName: 'gateway-revocation' });
 *
 *   app.addHook('preHandler', async (req, reply) => {
 *     const claims = await verifyJwt(req.headers.authorization);
 *     if (await isJwtRevoked(redis, claims.jti)) {
 *       return reply.code(401).send({ error: 'Token revoked' });
 *     }
 *   });
 *
 *   app.post('/auth/v1/revoke', async (req, reply) => {
 *     // Caller MUST have valid JWT (proves they own the token)
 *     const { jti, exp } = (req as any).user.claims;
 *     await revokeJwt(redis, jti, exp - Math.floor(Date.now() / 1000));
 *     return reply.send({ revoked: true });
 *   });
 *   ```
 *
 * Rollback: AISHA_SHARED_REDIS_DISABLED=true env (per-service) →
 * createNamespacedRedis returns null → all primitives become no-ops
 * (caching: pass-through; revocation: permissive). Service stays up.
 */
export * from './client.js';
export * from './revocation.js';
