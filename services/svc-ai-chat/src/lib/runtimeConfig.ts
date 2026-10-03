/**
 * v2 stub: runtime config helpers.
 *
 * @module
 */

/** Returns comma-separated allowed origins from env.
 *  SoT: ALLOWED_ORIGINS from config/domains.env (pushed by deploy-init).
 *  Localhost-only fallback (same contract as gateway) — never '*': a prod
 *  deploy missing the env var must fail closed, not open CORS to the world. */
export function getAllowedOriginsRaw(): string {
  return process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8100';
}
