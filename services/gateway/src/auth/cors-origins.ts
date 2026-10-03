/**
 * Dynamic CORS origin resolver — stale-while-revalidate.
 *
 * Static origins from `ALLOWED_ORIGINS` env (canonical from domains.env SoT,
 * pushed by coolify-deploy-init; legacy fallback to `CORS_ORIGINS`) are unioned
 * with hostnames from `public.branding_hostname_mapping`. This keeps the allowlist
 * dynamic from the single topology source.
 *
 * Hot path is SYNC: `getCachedAllowedOriginsSync()` returns the cached Set
 * without awaiting anything. A background `setInterval` keeps the cache
 * warm by re-fetching every `CACHE_TTL_MS` (default 60 s). If a refresh
 * fails (PostgREST briefly unavailable etc.) we KEEP the stale cache —
 * the request handler never blocks on DB IO.
 *
 * Earlier version awaited `resolveAllowedOrigins()` from a global
 * onRequest hook. Under load that meant 80 concurrent requests all
 * blocking on the single inflight fetch when the cache expired every
 * 60 s — a thundering-herd that exhausted the PostgREST pool and surfaced
 * as 500/503 storms in the browser. The SWR pattern eliminates that.
 *
 * Backward-compatible `resolveAllowedOrigins()` is retained for
 * `corsOriginCallback` (called by @fastify/cors), but it now returns the
 * cached set synchronously-wrapped in a resolved Promise — no IO wait
 * on hot path. On the very first call (before any background refresh
 * has populated the cache) it awaits one inline fetch as a cold-start
 * safety net.
 */

import { config } from '../config.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('gateway');
const CACHE_TTL_MS = 60_000;

const STATIC_ORIGINS = new Set<string>(
  config.corsOrigins.map((o) => o.trim()).filter(Boolean),
);

let cachedAllowedOrigins: Set<string> = new Set(STATIC_ORIGINS);
let lastFetchAt = 0;
let inflight: Promise<void> | null = null;
let bootstrapped = false;

async function fetchBrandHostnames(): Promise<string[]> {
  const url = `${config.postgrestUrl.replace(/\/$/, '')}/branding_hostname_mapping?select=hostname`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`branding_hostname_mapping fetch failed: HTTP ${res.status}`);
  }
  const rows = (await res.json()) as Array<{ hostname?: unknown }>;
  return rows
    .map((r) => (typeof r.hostname === 'string' ? r.hostname.trim() : ''))
    .filter(Boolean);
}

function buildOriginSet(hostnames: string[]): Set<string> {
  const merged = new Set<string>(STATIC_ORIGINS);
  for (const h of hostnames) {
    merged.add(`https://${h}`);
    if (!h.startsWith('localhost') && !/^[\d.]+$/.test(h)) {
      merged.add(`https://www.${h.replace(/^www\./, '')}`);
    }
  }
  return merged;
}

/**
 * Refresh the cached set in the background. Single-flight (only one
 * in-flight fetch at a time). On failure keeps the existing stale cache.
 * Never throws — callers are expected to fire-and-forget.
 */
function refreshAllowedOrigins(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const hostnames = await fetchBrandHostnames();
      cachedAllowedOrigins = buildOriginSet(hostnames);
      lastFetchAt = Date.now();
      bootstrapped = true;
    } catch (err) {
      // Keep stale cache; gateway must keep serving even if PostgREST is
      // briefly unhealthy. Log via stderr (visible in Coolify logs); avoid
      // pino to keep this module dependency-light.
      log.safeWarn(
        `[cors-origins] background refresh failed (serving stale ${cachedAllowedOrigins.size} origins): ${
          (err as Error).message
        }`,
      );
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Sync accessor for the hot path — returns the current cached set
 * immediately. Never awaits, never throws. The background interval
 * keeps this fresh; if the very first request lands before bootstrap
 * completes, this returns the static-only fallback set.
 */
export function getCachedAllowedOriginsSync(): Set<string> {
  return cachedAllowedOrigins;
}

/**
 * Async accessor retained for back-compat (e.g. @fastify/cors
 * corsOriginCallback). Returns the cached set without blocking on a
 * refresh; if cache is stale, kicks off a background refresh and
 * returns the current (stale) value immediately. Only the very first
 * call before any refresh has populated the cache will wait inline.
 */
export async function resolveAllowedOrigins(): Promise<Set<string>> {
  // First-ever call before bootstrap completed: wait once as a safety
  // net so we don't serve an empty allowlist to the gateway's CORS hook.
  if (!bootstrapped) {
    await refreshAllowedOrigins();
    return cachedAllowedOrigins;
  }
  // Stale-while-revalidate: trigger background refresh if needed but
  // return the current cache immediately.
  if (Date.now() - lastFetchAt > CACHE_TTL_MS) {
    void refreshAllowedOrigins();
  }
  return cachedAllowedOrigins;
}

/**
 * Origin callback compatible with @fastify/cors.
 *
 * If origin is undefined (same-origin / non-browser request) → allow.
 * Otherwise check against the merged static + DB-driven set. The sync
 * accessor means this resolves immediately without IO.
 */
export function corsOriginCallback(
  origin: string | undefined,
  cb: (err: Error | null, allow: boolean) => void,
): void {
  if (!origin) return cb(null, true);
  const allowed = getCachedAllowedOriginsSync();
  cb(null, allowed.has(origin));
  // Opportunistically refresh if stale (fire-and-forget).
  if (Date.now() - lastFetchAt > CACHE_TTL_MS) {
    void refreshAllowedOrigins();
  }
}

// Bootstrap: fire one refresh immediately on module load so the cache
// is populated as early as possible (before the first request arrives).
// `void` so the import doesn't block server.ts top-level await chain.
void refreshAllowedOrigins();

// Keep cache warm with a periodic background refresh. Failure is
// tolerated (stale-while-revalidate); see refreshAllowedOrigins().
// Unref so this interval doesn't hold the process alive on shutdown.
const refreshTimer = setInterval(
  () => void refreshAllowedOrigins(),
  CACHE_TTL_MS,
);
refreshTimer.unref?.();
