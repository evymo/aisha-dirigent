import { requireEnv } from '@aisha/security';
export const config = {
  port: parseInt(process.env.SVC_FIO_BANK_PORT ?? '3014', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── PostgREST (for RPC calls) ──
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-fio-bank', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // ── Keycloak JWT verification ──
  //
  // Issuer and JWKS are SEPARATE settings on purpose. `POST /sync` verifies a
  // BROWSER token (the admin Bank Reconciliation page calls it through
  // `aisha.functions.invoke`, and the web client attaches the Keycloak OIDC
  // access token). That token's `iss` is the PUBLIC IdP URL, while this service
  // can only reach Keycloak on an internal alias — behind an edge the two are
  // never the same string, so deriving both from `KEYCLOAK_URL` rejects every
  // user token with `unexpected "iss" claim value`.
  //
  // The same defect silently ate 100 % of /chat traffic on svc-ai-chat (21/21
  // calls over 72 h). Here it is unexercised rather than absent: production logs
  // show only /health and /metrics for 168 h, so nobody has clicked Sync — a
  // count of zero failures from zero attempts is not evidence of working.
  // gateway (KC_ISSUER/KC_JWKS_URL) and svc-pki-bridge (jwksUrl/expectedIssuer)
  // already ship this split.
  //
  // Defaults reproduce the previously derived values, so leaving both env vars
  // unset is a no-op.
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-fio-bank', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-fio-bank', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  /** Issuer expected in browser tokens (`iss`) — the public IdP URL. */
  kcIssuer:
    process.env.KC_ISSUER ??
    `${requireEnv('KEYCLOAK_URL', { service: 'svc-fio-bank', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' })}/realms/${requireEnv('KEYCLOAK_REALM', { service: 'svc-fio-bank', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' })}`,

  /** Where signing keys are fetched from — the internal URL. */
  kcJwksUrl:
    process.env.KC_JWKS_URL ??
    `${requireEnv('KEYCLOAK_URL', { service: 'svc-fio-bank', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' })}/realms/${requireEnv('KEYCLOAK_REALM', { service: 'svc-fio-bank', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' })}/protocol/openid-connect/certs`,

  // (The former `jwksUrl` getter is gone rather than kept as an alias: two names
  // for the key endpoint is how a caller ends up on the one that also decides the
  // issuer. Nothing else in this service read it.)

  // ── Fio API ──
  fioApiBase: 'https://www.fio.cz/ib_api/rest',
  fioApiTimeoutMs: 15_000,

  // ── Env fallback for Fio token ──
  fioApiTokenEnv: process.env.FIO_BANK_API_TOKEN ?? '',
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
