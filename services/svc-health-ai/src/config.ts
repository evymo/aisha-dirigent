import { requireEnv } from '@aisha/security';
export const config = {
  port: parseInt(process.env.SVC_HEALTH_AI_PORT ?? '3024', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
  /** Build SHA — stamped onto AITG run records. */
  buildSha: process.env.GIT_SHA ?? 'dev',

  // ── PostgREST ──
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-health-ai', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // ── Keycloak ──
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-health-ai', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-health-ai', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  get jwksUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  // ── LLM egress ──
  // Health-document analysis is a governed LLM egress: it MUST route through the
  // internal LLM gateway (AISHA Omni /v1), same pattern as svc-openclaw. The
  // gateway terminates provider credentials centrally and applies platform
  // governance — the service never talks to a public provider host directly.
  //
  // `HEALTH_AI_LLM_MODE` selects the egress:
  //   - `gateway` (DEFAULT) → POST {llmGatewayUrl}/v1/chat/completions
  //   - `direct`            → documented opt-in fallback to the provider host
  //                           configured in OPENAI_API_URL (no baked-in default;
  //                           must be supplied explicitly to enable direct mode).
  llmMode: (process.env.HEALTH_AI_LLM_MODE ?? 'gateway') as 'gateway' | 'direct',
  llmGatewayUrl: process.env.AISHA_LLM_GATEWAY_URL ?? '',
  llmGatewayKey: process.env.AISHA_LLM_GATEWAY_KEY ?? '',

  // ── Direct-mode fallback (opt-in only, HEALTH_AI_LLM_MODE=direct) ──
  // Klíč OpenAI se tu NEČTE (2026-10-02): bere ho route za běhu z trezoru instance
  // (credentials.ts, administrace „Poskytovatelé AI a tokeny").
  openaiApiUrl: process.env.OPENAI_API_URL ?? '',
  openaiModel: process.env.HEALTH_AI_MODEL ?? 'gpt-4o-mini',

  // ── MinIO (storage) ──
  minioUrl: process.env.MINIO_URL ?? 'http://minio:9000',

  // ── Limits ──
  analysesPerHour: 5,
  wearableAnalysesPerHour: 12,
  maxAnalysisFileSizeBytes: 10 * 1024 * 1024,
  maxAiInputChars: 4000,
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
