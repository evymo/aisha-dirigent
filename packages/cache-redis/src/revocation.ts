/**
 * JWT revocation set — Phase 12 WP 3.5.
 *
 * Without revocation, JWT logout is illusory — token stays valid until
 * its `exp` claim (5 min default). This module adds a Redis-backed
 * SISMEMBER check so the gateway can short-circuit revoked tokens
 * within 1 sec of logout.
 *
 * Storage shape:
 *   Redis DB 2 — `aisha:revoked:<jti>` keys, each with TTL matching the
 *   token's remaining lifetime so revoked entries auto-expire after
 *   the JWT would have naturally expired (no permanent storage).
 *
 * Gateway flow:
 *   1. User clicks Logout → POST /auth/v1/revoke { jti, exp }
 *   2. Gateway calls `revokeJwt(jti, exp - now)` from this module
 *   3. Every subsequent request → middleware calls `isJwtRevoked(jti)`
 *      → returns 401 if revoked
 *
 * Chování při výpadku (2026-08-23, po otočení na fail-closed):
 *   · KONTROLA (`isJwtRevoked`) → `true`, tedy ODMÍTNOUT. Neznalost není
 *     důkaz platnosti.
 *   · ZÁPIS (`revokeJwt`) → `false` + záznam do logu, tedy volající VÍ, že
 *     odvolání neproběhlo, a nesmí hlásit úspěch.
 * Dřív obojí vracelo `false` (fail-open) — kontrola tím tiše přijímala
 * odvolané tokeny. The
 * trade-off: a brief window where logout doesn't take effect. Tracked
 * by the `redis.revocation.failed` counter (WP 0.4 metrics).
 */
import type { Redis } from 'ioredis';

const KEY_PREFIX = 'aisha:revoked:';

/**
 * Mark a JWT as revoked. Sets a key with TTL matching the token's
 * remaining lifetime so the entry self-cleans after natural expiry.
 *
 * @param redis - Redis client bound to DB 2 (from createNamespacedRedis)
 * @param jti - JWT ID (from token claims; required by RFC 7519 §4.1.7)
 * @param ttlSec - Seconds until original JWT expiry (max 86400 = 1 day)
 * @returns true on success, false if Redis unreachable (fail-open)
 */
export async function revokeJwt(
  redis: Redis | null,
  jti: string,
  ttlSec: number,
): Promise<boolean> {
  if (!redis) return false;
  if (!jti || typeof jti !== 'string' || jti.length === 0) {
    throw new Error('revokeJwt: jti is required and must be a non-empty string');
  }
  if (!Number.isFinite(ttlSec) || ttlSec <= 0) {
    // Token already expired — no need to revoke, return success
    return true;
  }
  // Cap at 1 day — defense against attacker sending exp far in the future
  const cappedTtl = Math.min(Math.floor(ttlSec), 86400);
  try {
    // SET key "1" EX <ttl> — atomic, single round-trip
    await redis.set(KEY_PREFIX + jti, '1', 'EX', cappedTtl);
    return true;
  } catch (err) {
    // Vrací `false`, tedy „NEODVOLÁNO" — volající se to dozví a musí na to
    // reagovat. Chyba se ale nesmí spolknout beze slova: neúspěšné odvolání
    // je bezpečnostní událost, ne provozní detail (2026-08-23).
    console.error(`[revocation] zápis odvolání pro jti SELHAL — token zůstává platný:`, err);
    return false;
  }
}

/**
 * Je token odvolaný? Vrací `true`, když to VÍME — a nově i tehdy, když to
 * NEVÍME.
 *
 * ⛔ OTOČENO NA FAIL-CLOSED 2026-08-23 (rozhodnutí majitele). Do té doby se
 * při chybě Redisu vracelo `false`, tedy „není odvolaný", a požadavek prošel.
 * Naměřeno naostro: `shared-redis` byl nedosažitelný, gateway u KAŽDÉHO
 * přihlášeného požadavku hlásil
 *   `[revocation] redis.exists failed for jti — failing open`
 * a odvolané tokeny se přijímaly. Odhlášení, zneplatnění relace ani odebrání
 * přístupu v tu chvíli neúčinkovaly — a nikdo by si toho nevšiml, protože
 * navenek všechno fungovalo.
 *
 * Majitel: „nemáš info, že token není odvolán, a máš smůlu."
 *
 * ⚠️ CENA JE SKUTEČNÁ a původní komentář ji pojmenoval správně: při výpadku
 * Redisu se odmítne KAŽDÝ požadavek s tokenem. Je to vědomá volba — výpadek
 * úložiště je vidět okamžitě, kdežto tiché přijímání odvolaných tokenů ne.
 * Dostupnost se řeší tím, že Redis běží, ne tím, že se kontrola vypne.
 *
 * `redis === null` znamená „odvolávání není v téhle instalaci zapojené" —
 * to je jiný stav než „zapojené, ale nedostupné", a nechává se propustný.
 *
 * Výkon: jeden EXISTS roundtrip (~0,5 ms uvnitř clusteru).
 */
export async function isJwtRevoked(
  redis: Redis | null,
  jti: string,
): Promise<boolean> {
  if (!redis) return false;
  if (!jti || typeof jti !== 'string' || jti.length === 0) return false;
  try {
    const exists = await redis.exists(KEY_PREFIX + jti);
    return exists === 1;
  } catch (err) {
    // FAIL-CLOSED: neznalost NENÍ důkaz, že token platí.
    console.error(`[revocation] redis.exists selhal pro jti — ODMÍTÁM (fail-closed):`, err);
    return true;
  }
}

/**
 * Bulk-check (for batch validation, e.g. token introspection workflows).
 * Returns a Map of jti → revoked status. Single MGET pipeline call.
 */
export async function areJwtsRevoked(
  redis: Redis | null,
  jtis: ReadonlyArray<string>,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (!redis || jtis.length === 0) {
    for (const jti of jtis) result.set(jti, false);
    return result;
  }
  try {
    const keys = jtis.map((j) => KEY_PREFIX + j);
    const values = await redis.mget(...keys);
    for (let i = 0; i < jtis.length; i++) {
      result.set(jtis[i], values[i] !== null);
    }
  } catch (err) {
    // Táž fail-closed pozice jako u jednotlivého jti výš: dávkové selhání
    // nesmí projít jako „žádný z nich není odvolaný".
    console.error(`[revocation] mget dávka selhala (${jtis.length} jti) — ODMÍTÁM všechny (fail-closed):`, err);
    for (const jti of jtis) result.set(jti, true);
  }
  return result;
}

/** Test-only utility: clear all revocation keys (DON'T call in production). */
export async function _clearAllRevocations(redis: Redis | null): Promise<number> {
  if (!redis) return 0;
  const stream = redis.scanStream({ match: KEY_PREFIX + '*', count: 100 });
  let deleted = 0;
  for await (const keys of stream) {
    if ((keys as string[]).length === 0) continue;
    await redis.del(...(keys as string[]));
    deleted += (keys as string[]).length;
  }
  return deleted;
}
