/**
 * OWASP A05 — CORS allowlist factory.
 *
 * Hardline rule: never use `*` for credentialed APIs. The factory below
 * returns a function compatible with `@fastify/cors`'s `origin` option that:
 *
 *   1. Parses a comma-separated `CORS_ALLOWLIST` env value into a set.
 *   2. Returns true only for exact-match origins.
 *   3. Supports a single `*` entry to opt-in to wildcard explicitly
 *      (intended for public read-only endpoints — log a warning on use).
 *
 * Subdomain wildcards (`*.aisha.guru`) are intentionally NOT supported here
 * because they are easy to misconfigure; if you need them, gate at a different
 * layer (Traefik / edge proxy).
 */

import type { AsyncOriginFunction } from '@fastify/cors';
import { createSafeLogger } from './logger.js';

/**
 * Origin check using `@fastify/cors`'s exported `AsyncOriginFunction` —
 * the modern async-native variant introduced alongside the legacy
 * `OriginFunction` callback API. Signature is `(origin) => Promise<allow>`.
 *
 * Why async over the v10-era callback API:
 *   - Aligns with native async/await Node patterns; no callback nesting.
 *   - Lets us throw on misconfiguration (caught by Fastify error handler)
 *     instead of `callback(new Error(...))`.
 *   - Promise allocation overhead per request is ~10µs; CORS preflight
 *     gates are not in the hot path anyway.
 *
 * The allowlist lookup itself is in-memory and synchronous — we just
 * wrap the boolean in a resolved Promise to satisfy the async signature.
 */
export type CorsOriginFn = AsyncOriginFunction;

export interface CorsAllowlistOptions {
  /** Comma-separated origins string from env. */
  allowlist: string;
  /** Service name, used for warning logs when a request is rejected. */
  service: string;
  /** Allow requests without an `Origin` header (server-to-server). Default: true. */
  allowNoOrigin?: boolean;
}

export function buildCorsOriginCheck(opts: CorsAllowlistOptions): CorsOriginFn {
  const { allowlist, service, allowNoOrigin = true } = opts;
  const log = createSafeLogger(`cors:${service}`);

  const entries = allowlist
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    log.safeWarn('cors.empty_allowlist', { service });
  }
  const wildcard = entries.includes('*');
  if (wildcard) {
    log.safeWarn('cors.wildcard_enabled', { service });
  }
  const exactSet = new Set(entries.filter((e) => e !== '*'));

  return async (origin) => {
    if (!origin) {
      // Server-to-server or curl requests have no Origin header.
      return allowNoOrigin;
    }
    if (wildcard) return true;
    if (exactSet.has(origin)) return true;
    log.safeWarn('cors.deny', { origin, service });
    return false;
  };
}

export interface CorsOptions {
  origin: CorsOriginFn;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  maxAge: number;
}

/** Build a full `@fastify/cors` options object from an allowlist env value. */
export function buildCorsOptions(opts: CorsAllowlistOptions): CorsOptions {
  return {
    origin: buildCorsOriginCheck(opts),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Trace-Id'],
    exposedHeaders: ['X-Trace-Id', 'X-Rate-Limit-Remaining'],
    maxAge: 600,
  };
}
