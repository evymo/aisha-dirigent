/**
 * Rate Limiter for Supabase Edge Functions
 * 
 * Simple in-memory rate limiting with sliding window.
 * Note: This is per-instance rate limiting. For distributed rate limiting,
 * consider using Redis/Upstash or a database-backed solution.
 * 
 * @module _shared/rateLimiter
 */

interface RateLimitRecord {
  count: number;
  windowStart: number;
}

// In-memory store for rate limiting (per instance)
const rateLimitStore = new Map<string, RateLimitRecord>();

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Prefix for the rate limit key (e.g., 'checkout', 'packeta') */
  keyPrefix: string;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in current window */
  remaining: number;
  /** When the rate limit window resets */
  resetAt: Date;
  /** Current request count in window */
  current: number;
}

/**
 * Check if a request should be rate limited
 * 
 * @param identifier - Unique identifier (usually user ID)
 * @param config - Rate limit configuration
 * @returns Rate limit result with allowed status and metadata
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const key = `${config.keyPrefix}:${identifier}`;
  
  // Get or create rate limit record
  let record = rateLimitStore.get(key);
  
  // Check if we need to reset the window
  if (!record || (now - record.windowStart) >= config.windowMs) {
    record = {
      count: 0,
      windowStart: now,
    };
    rateLimitStore.set(key, record);
  }
  
  const resetAt = new Date(record.windowStart + config.windowMs);
  const allowed = record.count < config.max;
  
  if (allowed) {
    record.count++;
  }
  
  return {
    allowed,
    remaining: Math.max(0, config.max - record.count),
    resetAt,
    current: record.count,
  };
}

/**
 * Create a 429 Too Many Requests response
 * 
 * @param result - Rate limit result
 * @param corsHeaders - CORS headers to include
 * @returns Response with appropriate headers
 */
export function rateLimitResponse(
  result: RateLimitResult,
  corsHeaders: Record<string, string> = {}
): Response {
  const retryAfterSeconds = Math.ceil(
    (result.resetAt.getTime() - Date.now()) / 1000
  );
  
  return new Response(
    JSON.stringify({
      error: "Too many requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter: result.resetAt.toISOString(),
      remaining: result.remaining,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, retryAfterSeconds)),
        "X-RateLimit-Limit": String(result.current + result.remaining),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": result.resetAt.toISOString(),
      },
    }
  );
}

/**
 * Cleanup old rate limit records to prevent memory leaks
 * Call this periodically or after each request
 */
export function cleanupRateLimitStore(maxAgeMs: number = 3600000): void {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if ((now - record.windowStart) > maxAgeMs) {
      rateLimitStore.delete(key);
    }
  }
}

// Pre-configured rate limit configs for common use cases
export const RATE_LIMITS = {
  /** Checkout: 10 requests per hour */
  checkout: {
    max: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "checkout",
  } satisfies RateLimitConfig,
  
  /** Packeta API: 30 requests per minute */
  packeta: {
    max: 30,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: "packeta",
  } satisfies RateLimitConfig,
  
  /** AI Analysis: 5 requests per minute */
  aiAnalysis: {
    max: 5,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: "ai-analysis",
  } satisfies RateLimitConfig,
  
  /** Document upload: 20 per hour */
  documentUpload: {
    max: 20,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "doc-upload",
  } satisfies RateLimitConfig,
} as const;
