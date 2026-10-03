import { requireEnv } from '@aisha/security';
/** svc-github-app configuration */
export const config = {
  port: parseInt(process.env.PORT ?? "3016", 10),
  logLevel: process.env.LOG_LEVEL ?? "info",

  /** PostgREST base URL */
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-github-app', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  /** PostgREST service-role JWT */
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  /** Keycloak OIDC */
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-github-app', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-github-app', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),
  get jwksUrl() {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  /** GitHub App settings */
  githubAppId: process.env.GITHUB_APP_ID ?? "",
  githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",

  /** n8n webhook base URL for event forwarding */
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "",

  /** Installation token cache TTL (ms) */
  tokenCacheTtlMs: parseInt(process.env.TOKEN_CACHE_TTL_MS ?? "3000000", 10), // 50min
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
