import { requireEnv } from '@aisha/security';
export const config = {
  port: parseInt(process.env.SVC_PACKETA_PORT ?? '3028', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── PostgREST ──
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-packeta', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // ── Keycloak ──
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-packeta', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-packeta', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  get jwksUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  // ── Packeta / Zásilkovna ──
  packetaApiKey: process.env.PACKETA_API_KEY ?? '',
  packetaApiUrl: process.env.PACKETA_API_URL ?? 'https://www.zasilkovna.cz/api/rest',
  packetaXmlApiUrl: process.env.PACKETA_XML_API_URL ?? 'https://www.zasilkovna.cz/api/v4/%API_KEY%/branch.xml',

  // ── Feed cache TTL (ms) ──
  branchFeedTtl: parseInt(process.env.PACKETA_BRANCH_FEED_TTL ?? String(3600_000), 10), // 1 hour
  carrierFeedTtl: parseInt(process.env.PACKETA_CARRIER_FEED_TTL ?? String(86400_000), 10), // 24 hours

  // ── Shipping cost defaults ──
  defaultShippingCostCzk: parseInt(process.env.DEFAULT_SHIPPING_COST_CZK ?? '89', 10),
  freeShippingThreshold: parseInt(process.env.FREE_SHIPPING_THRESHOLD ?? '1500', 10),
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
