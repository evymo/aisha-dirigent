import { requireEnv } from '@aisha/security';
export const config = {
  port: parseInt(process.env.SVC_MATRIX_PORT ?? '3026', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── PostgREST ──
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-matrix', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // ── Keycloak ──
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-matrix', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-matrix', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),
  // Issuer composed from keycloakUrl + realm at first access; explicit
  // KEYCLOAK_ISSUER / KC_ISSUER env wins for cross-tenant setups where the
  // public realm URL differs from the internal Docker hostname.
  keycloakIssuer: process.env.KEYCLOAK_ISSUER ?? process.env.KC_ISSUER ?? `${process.env.AUTH_PUBLIC_URL ?? requireEnv('KEYCLOAK_URL', { service: 'svc-matrix', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' })}/realms/${requireEnv('KEYCLOAK_REALM', { service: 'svc-matrix', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' })}`,

  get jwksUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  // ── Synapse ──
  synapseAdminUrl: process.env.SYNAPSE_ADMIN_URL ?? 'http://synapse:8008',
  synapseRegistrationSecret: process.env.SYNAPSE_REGISTRATION_SECRET ?? '',
  matrixDomain: process.env.MATRIX_DOMAIN ?? '',

  // ── Webhook ──
  matrixWebhookSecret: process.env.MATRIX_WEBHOOK_SECRET ?? '',
  n8nMatrixWebhookUrl: process.env.N8N_MATRIX_WEBHOOK_URL ?? '',
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
