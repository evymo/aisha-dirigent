/**
 * `applySecurity(app, config)` — single-call wrapper that wires every OWASP
 * primitive into a Fastify service.
 *
 * Each service's `server.ts` should call this right after `Fastify({ ... })`
 * creation, BEFORE registering route plugins. This guarantees uniform
 * adoption and lets the OWASP umbrella gate test enforce its presence.
 *
 * Why a single wrapper instead of per-primitive calls:
 *   - The gate test can grep for one canonical marker (`applySecurity(`).
 *   - Order of plugin registration matters (helmet > cors > rate-limit > auth);
 *     centralising it here makes the order an implementation detail.
 *   - Default-deny defaults are baked in — services opt OUT explicitly rather
 *     than opting IN to security.
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildHelmetOptions, type HelmetConfigOptions } from './helmet.js';
import { buildCorsOptions, type CorsAllowlistOptions } from './cors.js';
import {
  buildGlobalRateLimitOptions,
  type GlobalRateLimitOptions,
} from './rateLimit.js';
import { createSafeLogger } from './logger.js';
import { toPublicError } from './errors.js';

export interface ApplySecurityConfig {
  /** Service name (must match its package.json). */
  service: string;
  /** Helmet config — pass {enableContentSecurityPolicy:true} only for browser-facing services. */
  helmet?: HelmetConfigOptions;
  /** CORS allowlist (comma-separated origins from env). */
  cors: Omit<CorsAllowlistOptions, 'service'>;
  /** Global rate-limit fallback. Per-route overrides via `routeRateLimit(tier)`. */
  rateLimit?: GlobalRateLimitOptions;
  /** When true, skips installing the global error handler (service has its own). */
  skipErrorHandler?: boolean;
}

/**
 * Registers helmet, cors, rate-limit, sets safe error handler, and emits a
 * boot-time confirmation log. Returns the same `app` for chaining.
 */
export async function applySecurity(
  app: FastifyInstance,
  config: ApplySecurityConfig,
): Promise<FastifyInstance> {
  const log = createSafeLogger(`security:${config.service}`);

  // Dynamic imports keep `@fastify/helmet` etc. as peer deps of consuming
  // services (we don't want every consumer to inherit them unconditionally).
  const helmet = (await import('@fastify/helmet')).default;
  const cors = (await import('@fastify/cors')).default;
  const rateLimit = (await import('@fastify/rate-limit')).default;

  await app.register(helmet, buildHelmetOptions(config.helmet));
  await app.register(
    cors,
    buildCorsOptions({ ...config.cors, service: config.service }),
  );
  await app.register(rateLimit, buildGlobalRateLimitOptions(config.rateLimit));

  if (!config.skipErrorHandler) {
    app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
      const { statusCode, body } = toPublicError(err);
      if (statusCode >= 500) {
        log.safeError('unhandled_error', err, {
          method: req.method,
          url: req.url,
        });
      }
      void reply.code(statusCode).send(body);
    });
  }

  log.safeInfo('security.applied', {
    service: config.service,
    helmet: true,
    cors: true,
    rateLimit: config.rateLimit?.enabled !== false,
  });
  return app;
}
