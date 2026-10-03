/**
 * OWASP A04 — Insecure Design: rate limiting & burst protection.
 *
 * Two-layer strategy:
 *   1. Global limit registered at server boot (catches DOS attempts on /health
 *      or unhandled paths).
 *   2. Per-route overrides via `routeRateLimit(tier)` config in route handlers,
 *      mapped to operation sensitivity (auth, mutation, expensive, public).
 *
 * Tiers match OWASP ASVS 11.1.4 ("throttle authentication attempts") and
 * 11.1.5 ("disable functionality after threshold").
 *
 * We key by `auth.uid()` when available (from req.user.sub) and fall back to
 * IP — this prevents abuse from a single account behind a NAT.
 */

import type { FastifyRequest } from 'fastify';

/** `code` odmítnutí z našeho limitu dotazů — podle něj ho `pluginRejection` pozná. */
export const RATE_LIMITED_CODE = 'AISHA_RATE_LIMITED';

export type RateLimitTier = 'auth' | 'mutation' | 'expensive' | 'public' | 'health' | 'device-download';

export interface RateLimitTierConfig {
  max: number;
  /** Time window in milliseconds. */
  timeWindow: number;
  /** Optional ban duration after exceeding (ms) — `@fastify/rate-limit` `ban` option. */
  ban?: number;
}

/**
 * Tier definitions tuned for AISHA orchestrator services.
 *
 * - `auth`: login/refresh/MFA — 5/min, 60s ban prevents credential stuffing
 *   (aligned with OWASP ASVS 11.1.4).
 * - `mutation`: writes (POST/PUT/PATCH/DELETE) — 30/min, prevents bulk writes
 *   without blocking normal usage.
 * - `expensive`: LLM completions, file processing — 10/min, protects cost
 *   budget and prevents resource exhaustion.
 * - `public`: unauthenticated reads — 60/min, generous but bounded.
 * - `health`: `/health` and `/ready` endpoints — 600/min for monitoring.
 * - `device-download`: ranged downloads of immutable device packages (kiosk
 *   tablets) — 600/min. Measured 2026-09-28: tablets on LTE share the operator's
 *   CGNAT address, and the global 100/min answered 429 mid-download (a 52 MB
 *   package in 1 MB ranges is 50 requests per tablet). The client waits on
 *   429 (Retry-After) and grows its ranges on a fast link (~10 requests per
 *   package), so 600/min serves ~40 tablets per address per minute; each
 *   request is bounded by the client's maximum range (8 MB).
 */
export const RATE_LIMIT_TIERS: Record<RateLimitTier, RateLimitTierConfig> = {
  auth: { max: 5, timeWindow: 60_000, ban: 60_000 },
  mutation: { max: 30, timeWindow: 60_000 },
  expensive: { max: 10, timeWindow: 60_000 },
  public: { max: 60, timeWindow: 60_000 },
  health: { max: 600, timeWindow: 60_000 },
  'device-download': { max: 600, timeWindow: 60_000 },
};

/** Build per-route rate-limit config for a Fastify route definition. */
export function routeRateLimit(tier: RateLimitTier): { rateLimit: RateLimitTierConfig } {
  return { rateLimit: RATE_LIMIT_TIERS[tier] };
}

/**
 * Key generator that prefers authenticated user id, falls back to IP.
 * Plug into `@fastify/rate-limit` `keyGenerator` option.
 */
export function keyByUserOrIp(req: FastifyRequest): string {
  // req.user is set by our JWT preHandler — see jwt.ts onRequest hook.
  const userId = (req as { user?: { sub?: string } }).user?.sub;
  if (userId) return `u:${userId}`;
  return `ip:${req.ip}`;
}

export interface GlobalRateLimitOptions {
  /** Maximum requests per window when no per-route override is set. */
  max?: number;
  /** Window in milliseconds. */
  timeWindow?: number;
  /** Whether to enable the rate limiter at all (allows opt-out in dev). */
  enabled?: boolean;
}

export function buildGlobalRateLimitOptions(opts: GlobalRateLimitOptions = {}): Record<string, unknown> {
  const { max = 100, timeWindow = 60_000, enabled = true } = opts;
  return {
    global: enabled,
    max,
    timeWindow,
    keyGenerator: keyByUserOrIp,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    errorResponseBuilder: (_req: FastifyRequest, ctx: { after: string; max: number }) => ({
      statusCode: 429,
      // Značka původu: obsluha chyb propustí 429 jen od NAŠEHO limitu, ne
      // 429 od upstreamu, které by doputovalo z volání cizího API.
      code: RATE_LIMITED_CODE,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${ctx.after}.`,
    }),
  };
}
