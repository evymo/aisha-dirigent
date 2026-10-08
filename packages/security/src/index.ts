/**
 * @aisha/security — OWASP Top 10 (2021) hardening primitives for AISHA
 * orchestrator services (Fastify + PostgREST stack).
 *
 * Module → OWASP category map:
 *   logger.ts       → A09  Security Logging & Monitoring Failures
 *   logOptions.ts   → A09  (Fastify / pino logger factory: safe req/err serializers)
 *   audit.ts        → A09  (compliance/append-only trail)
 *   cors.ts         → A05  Security Misconfiguration
 *   helmet.ts       → A05  Security Misconfiguration
 *   rateLimit.ts    → A04  Insecure Design
 *   jwt.ts          → A07  Identification & Authentication Failures
 *   ssrf.ts         → A10  Server-Side Request Forgery
 *   errors.ts       → A03  Injection (validated input) + A05 (safe errors)
 *   secrets.ts      → A02  Cryptographic Failures
 *
 * Categories A01 (Broken Access Control), A06 (Vulnerable Components),
 * and A08 (Software & Data Integrity) are enforced outside the package:
 *   - A01: PostgREST RLS + SECURITY DEFINER RPCs in aisha/db/sql/
 *   - A06: Dependabot in .github/dependabot.yml + npm audit gate in CI
 *   - A08: SBOM + cosign signing in .github/workflows/release.yml
 *
 * The `applySecurity(app, config)` Fastify wrapper is the single canonical
 * way to wire all middlewares into a service. Each service's `server.ts`
 * should call this immediately after `Fastify({ ... })`.
 */

export * from './logger.js';
export * from './logOptions.js';
export * from './audit.js';
export * from './cors.js';
export * from './helmet.js';
export * from './rateLimit.js';
export * from './jwt.js';
export * from './ssrf.js';
export * from './untrusted.js';
export * from './errors.js';
export * from './secrets.js';
export * from './env.js';
export * from './rotationManifests.js';
export * from './credentials.js';

export { applySecurity } from './applySecurity.js';
export type { ApplySecurityConfig } from './applySecurity.js';
