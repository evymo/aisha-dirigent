// =============================================================================
// local-env-assertions.mjs — local-stack "env doctor" (pure, side-effect-free)
// =============================================================================
// Pure assertion helpers + validateLocalStackEnv(). NO I/O, NO process.exit —
// every function THROWS an Error (or, for validateLocalStackEnv, collects all
// failures and throws ONE listing every failing key). Unit-tested in isolation
// (scripts/lib/local-env-assertions.test.mjs).
//
// WHY — scripts/aisha-env-doctor.mjs validates PROD env (.env.coolify) only, and
// local-compose-gen's env-completeness pass catches a bare `${VAR}` that resolves
// to "" but NOT a key that HOLDS a placeholder (POSTGREST_SERVICE_TOKEN=
// "dev-service-role-key") or a too-short/empty JWT_SECRET. Those slipped through
// and broke svc-mcp-knowledge service-role auth (jwtVerify fails on a non-JWT
// token → PGRST301). This module is the missing critical-env validator: it runs
// in local-compose-gen as a HARD-FAIL on the RESOLVED per-service env BEFORE the
// compose is written, so malformed secrets never reach the local stack.
// =============================================================================

// Reject obvious placeholder / sentinel values. Anchored at the START so a real
// secret that merely CONTAINS a substring is not falsely flagged; "" is rejected
// outright. Matches: changeme, placeholder, todo, xxx, dev-anon-role*,
// dev-service-role* (the exact class that broke svc-mcp-knowledge auth).
const PLACEHOLDER_RE = /^(changeme|placeholder|todo|xxx|dev-(anon|service)-role)/i;

// A base64url segment: non-empty, only the URL-safe base64 alphabet (no padding,
// no "+"/"/"). A real JWT has three of these joined by ".".
const B64URL_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Assert a value is a non-empty string of at least `minLen` characters.
 * @param {string} name  env var name (for the error message)
 * @param {unknown} val
 * @param {number} [minLen=1]
 */
export function assertNonEmpty(name, val, minLen = 1) {
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${name}: must be a non-empty string (got ${describe(val)})`);
  }
  if (val.length < minLen) {
    throw new Error(`${name}: must be at least ${minLen} characters (got ${val.length})`);
  }
}

/**
 * Assert a value is NOT a placeholder / sentinel (and not empty).
 * @param {string} name
 * @param {unknown} val
 */
export function assertNotPlaceholder(name, val) {
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${name}: must not be empty (placeholder check)`);
  }
  if (PLACEHOLDER_RE.test(val)) {
    throw new Error(`${name}: looks like a placeholder/sentinel value ("${val}") — set a real dev value`);
  }
}

/**
 * Assert a value is a well-formed JWT shape: exactly three non-empty base64url
 * segments split by ".". Does NOT verify the signature (a dev token signed with
 * the dev secret is legitimate) — only the SHAPE, which is what catches a
 * placeholder string like "dev-service-role-key" being used as a token.
 * @param {string} name
 * @param {unknown} val
 */
export function assertJwtShape(name, val) {
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${name}: must be a non-empty JWT string (got ${describe(val)})`);
  }
  const parts = val.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new Error(`${name}: must be a JWT with 3 non-empty segments (got ${parts.length} segment(s))`);
  }
  const bad = parts.find((p) => !B64URL_SEGMENT_RE.test(p));
  if (bad !== undefined) {
    throw new Error(`${name}: JWT segment is not valid base64url ("${bad.slice(0, 16)}…")`);
  }
}

/**
 * Assert a value is a URL whose authority (host[:port]) is non-empty.
 * Accepts scheme://authority[/path...]. Catches the "https:///realms/aisha"
 * malformed class (empty host from an unset domain var).
 * @param {string} name
 * @param {unknown} val
 */
export function assertNonEmptyUrlHost(name, val) {
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${name}: must be a non-empty URL (got ${describe(val)})`);
  }
  // scheme://authority — authority is everything up to the first / ? # after //.
  const m = val.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/);
  if (!m) {
    throw new Error(`${name}: must be a "scheme://authority" URL (got "${val}")`);
  }
  const authority = m[2];
  if (authority.length === 0) {
    throw new Error(`${name}: URL has an empty host/authority ("${val}")`);
  }
  // A bare "@" or ":" with nothing after it (e.g. http://:8080 or http://@/x)
  // means no actual host — strip optional userinfo, then require a host before
  // any port colon.
  const hostport = authority.includes("@") ? authority.slice(authority.indexOf("@") + 1) : authority;
  const host = hostport.split(":")[0];
  if (host.length === 0) {
    throw new Error(`${name}: URL has an empty host ("${val}")`);
  }
}

/**
 * Assert an oauth2-proxy cookie secret is EXACTLY 16, 24, or 32 bytes — the only AES
 * key sizes oauth2-proxy accepts ("cookie_secret must be 16, 24, or 32 bytes to create
 * an AES cipher"). A 39-byte dev default (the misnamed D32) crash-loops every
 * oauth2-proxy'd service (pgadmin / pki / n8n auth proxies).
 * @param {string} name
 * @param {unknown} val
 */
export function assertCookieSecret(name, val) {
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${name}: must be a non-empty cookie secret (got ${describe(val)})`);
  }
  const bytes = Buffer.byteLength(val, "utf8");
  if (bytes !== 16 && bytes !== 24 && bytes !== 32) {
    throw new Error(`${name}: oauth2-proxy cookie secret must be exactly 16, 24, or 32 bytes (got ${bytes})`);
  }
}

function describe(val) {
  if (val === undefined) return "undefined";
  if (val === null) return "null";
  if (typeof val === "string") return `"${val}"`;
  return String(val);
}

// =============================================================================
// validateLocalStackEnv — apply the critical assertions across resolved services
// =============================================================================
//
// `resolvedServices` is a map { serviceKey → { env: {NAME: value, ...} } } of the
// RESOLVED (docker-compose-config-style) per-service env. Caller is responsible
// for flattening each service's environment (array "K=V" or object) into an
// `env` object and for back-filling the critical secrets from devEnvDefaults when
// the service references them only via the shared env-file (so the resolved view
// would otherwise lack the key). This module only judges values it is GIVEN —
// it never reaches out to read files or env.
//
// Critical per-key rules (per the operator's spec):
//   POSTGREST_SERVICE_TOKEN → assertJwtShape + assertNotPlaceholder
//   KC_JWKS_URL / KC_ISSUER / KEYCLOAK_URL / POSTGREST_URL → assertNonEmptyUrlHost
//   JWT_SECRET → assertNonEmpty(32)
// Every failure is collected; one Error listing every failing "service.KEY" is
// thrown at the end (so the operator fixes them all in one pass).

/** @type {Record<string, (name: string, val: string) => void>} */
const CRITICAL_RULES = {
  POSTGREST_SERVICE_TOKEN: (n, v) => {
    assertNotPlaceholder(n, v);
    assertJwtShape(n, v);
  },
  JWT_SECRET: (n, v) => assertNonEmpty(n, v, 32),
  KC_JWKS_URL: assertNonEmptyUrlHost,
  KC_ISSUER: assertNonEmptyUrlHost,
  KEYCLOAK_URL: assertNonEmptyUrlHost,
  POSTGREST_URL: assertNonEmptyUrlHost,
  // oauth2-proxy cookie secrets — must be exactly 16/24/32 bytes or the proxy crash-loops.
  PKI_COOKIE_SECRET: assertCookieSecret,
  STUDIO_COOKIE_SECRET: assertCookieSecret,
  N8N_COOKIE_SECRET: assertCookieSecret,
  OAUTH2_PROXY_COOKIE_SECRET: assertCookieSecret,
};

/** The set of critical env keys this doctor validates (exported for callers). */
export const CRITICAL_ENV_KEYS = Object.keys(CRITICAL_RULES);

/**
 * Validate the critical per-service env. Collects ALL failures and throws ONE
 * Error naming every failing key. No-op (returns) when nothing is wrong.
 *
 * @param {Record<string, { env?: Record<string, unknown> }>} resolvedServices
 * @returns {{ checked: number }}  count of (service,key) pairs actually checked
 */
export function validateLocalStackEnv(resolvedServices) {
  if (!resolvedServices || typeof resolvedServices !== "object") {
    throw new Error("validateLocalStackEnv: resolvedServices must be an object map");
  }
  const failures = [];
  let checked = 0;
  for (const [svcKey, svc] of Object.entries(resolvedServices)) {
    const env = svc && typeof svc === "object" ? svc.env : undefined;
    if (!env || typeof env !== "object") continue;
    for (const [key, rule] of Object.entries(CRITICAL_RULES)) {
      if (!(key in env)) continue; // only judge keys the service actually declares
      checked++;
      try {
        rule(key, env[key]);
      } catch (err) {
        failures.push(`${svcKey}.${key}: ${err.message.replace(/^[^:]*:\s*/, "")}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Local stack env validation FAILED — ${failures.length} critical env problem(s):\n` +
        failures.map((f) => `  - ${f}`).join("\n"),
    );
  }
  return { checked };
}
