/**
 * scripts/lib/env.mjs — env-only configuration loader for Node-based tooling.
 *
 * STRICT RULE (project-wide invariant):
 *   NO hardcoded URLs, secrets, or environment-specific literals in source.
 *   All values come from canonical config files OR process.env.
 *
 * Sources (loaded in priority order — first-write-wins; process.env is final):
 *   1. config/domains.env         — canonical domain values (committed, public)
 *   2. .env.aisha                 — developer-local AISHA config (gitignored)
 *   3. .env-prod-backup           — production credentials (gitignored)
 *   4. process.env                — runtime override (always wins)
 *
 * Each required export validates at import time. If a value is missing, the
 * module throws with a clear, actionable error. NO hardcoded fallbacks.
 *
 * Adding a new env var:
 *   1. Add to the right canonical config file (config/domains.env for
 *      committed domains, .env-prod-backup for secrets/per-env values).
 *   2. Add `export const FOO = required('FOO', '<hint>')` below.
 *   3. NEVER add a hardcoded fallback. Missing config = misconfigured
 *      deployment = script must fail fast.
 *
 * Usage:
 *   import { COOLIFY_URL } from './lib/env.mjs';
 *   await fetch(`${COOLIFY_URL}/api/v1/...`);
 *
 * @module
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

/** Load a `.env`-style file into process.env (first-write-wins; never overrides set values). */
function loadEnvFile(absPath) {
  if (!existsSync(absPath)) return;
  const content = readFileSync(absPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (e.g. KEY="value")
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// Load canonical config in priority order. process.env always wins because
// loadEnvFile only writes unset keys.
loadEnvFile(join(ROOT, 'config', 'domains.env'));
loadEnvFile(join(ROOT, '.env.aisha'));
loadEnvFile(join(ROOT, '.env-prod-backup'));

/** Throw if the requested env var is missing. Centralizes the error message. */
function required(name, hintConfigFile) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[env.mjs] Missing required env var ${name}. ` +
      `Add it to ${hintConfigFile} (or export ${name}=... before running). ` +
      `NO hardcoded defaults allowed in source — see scripts/lib/env.mjs header.`,
    );
  }
  return v;
}

/**
 * Compose an https URL from a domain env var. The URL itself may be set
 * directly via an *_URL env var (which takes precedence); otherwise it's
 * derived as `https://${<DOMAIN_VAR>}`. Both come from env — neither is
 * hardcoded — the derivation rule is "URL = HTTPS of domain".
 */
function urlFromDomain(urlEnvKey, domainEnvKey, hintConfigFile) {
  if (process.env[urlEnvKey]) return process.env[urlEnvKey];
  return `https://${required(domainEnvKey, hintConfigFile)}`;
}

// ─── Required URLs (validated at import time) ────────────────────────────────

/**
 * Coolify control-plane URL (operator-declared in `.env-prod-backup`).
 * OPTIONAL and NOT validated at import, like GIT_BASE_URL below: only
 * finalize-production-kb records it, and it checks it itself. Validating it here
 * failed every other importer — measured 2026-10-08: the n8n workflow init
 * (deploy-workflows, provision-credentials need only N8N_URL + key) died on
 * "Missing required env var COOLIFY_URL" and no workflow was delivered.
 * Empty = not declared — never a derived or literal host.
 */
export const COOLIFY_URL = process.env.COOLIFY_URL ?? '';

/**
 * Git host the stack is cloned from (operator-declared, e.g. in .env-prod-backup).
 * OPTIONAL and NOT validated at import: only finalize-production-kb records it,
 * and every other importer of this module must keep working without it. Empty =
 * not declared (the consumer omits it) — never a derived or literal host.
 */
export const GIT_BASE_URL = process.env.GIT_BASE_URL ?? '';

/** Public n8n entry point. URL or derived from N8N_DOMAIN. */
export const N8N_URL = urlFromDomain('N8N_URL', 'N8N_DOMAIN', 'config/domains.env');

/** AISHA backend gateway (public API). Derived from API_DOMAIN_PUBLIC. */
export const DIRIGENT_API_URL = urlFromDomain('DIRIGENT_API_URL', 'API_DOMAIN_PUBLIC', 'config/domains.env');

/** AISHA web app. Derived from APP_DOMAIN. */
export const DIRIGENT_URL = urlFromDomain('DIRIGENT_URL', 'APP_DOMAIN', 'config/domains.env');

/** Langfuse observability. Derived from LANGFUSE_DOMAIN. */
export const LANGFUSE_URL = urlFromDomain('LANGFUSE_URL', 'LANGFUSE_DOMAIN', 'config/domains.env');

// ─── Optional values (callers handle null) ───────────────────────────────────

/** n8n API key — required only by scripts that hit n8n. Use `requireN8nApiKey()`. */
export const N8N_API_KEY = process.env.N8N_API_KEY ?? null;

/** AISHA PostgREST URL — required only by local-dev tools. */
export const AISHA_POSTGREST_URL = process.env.AISHA_POSTGREST_URL ?? null;

/** @deprecated Use AISHA_POSTGREST_URL. Kept for compat with existing imports. */
export const SUPABASE_LOCAL_URL = AISHA_POSTGREST_URL;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lazy-require N8N_API_KEY. Scripts that only import URL constants don't
 * need the API key; this is called only by scripts that actually hit n8n.
 */
export function requireN8nApiKey() {
  if (!N8N_API_KEY) {
    console.error(
      'ERROR: N8N_API_KEY not set. Add it to .env.aisha or export N8N_API_KEY=...',
    );
    process.exit(1);
  }
  return N8N_API_KEY;
}

export const n8nHeaders = N8N_API_KEY
  ? { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' }
  : null;
