import { requireEnv } from '@aisha/security';
export const config = {
  port: parseInt(process.env.SVC_PLUGIN_SYSTEM_PORT ?? '3029', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── PostgREST ──
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-plugin-system', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // ── Keycloak ──
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-plugin-system', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-plugin-system', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  get jwksUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  // ── MinIO / S3 (plugin artifact storage) ──
  // Jen ADRESA úložiště: podle ní SSRF guard pouští stažení artefaktu
  // (sandbox.ts downloadAndVerifyArtifact). ⛔ 2026-09-16: klíče a bucket se tu
  // načítaly, ale nikdo je nepoužil — kontejner zbytečně držel pověření k MinIO.
  s3Endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',

  // ── Governed LLM router (for plugin LLM capability) ──
  aiGenerateUrl:
    process.env.AI_GENERATE_URL ??
    `${(process.env.AISHA_GATEWAY_URL ?? process.env.GATEWAY_URL ?? 'http://gateway:3001').replace(/\/+$/, '')}/functions/v1/ai-generate`,

  // ── Plugin sandbox ──
  pluginTimeoutMs: parseInt(process.env.PLUGIN_TIMEOUT_MS ?? '30000', 10),
  rpcWhitelist: (process.env.PLUGIN_RPC_WHITELIST ?? '').split(',').filter(Boolean),
  networkAllowlist: (process.env.PLUGIN_NETWORK_ALLOWLIST ?? '').split(',').filter(Boolean),

  // ── Push notification endpoint (for plugin notify capability) ──
  pushServiceUrl: process.env.PUSH_SERVICE_URL ?? 'http://svc-push:3012',

  // ── Agent runner (isolated execution plane) ──
  agentRunnerUrl: process.env.AGENT_RUNNER_URL ?? 'http://svc-agent-runner:3030',
  agentRunnerEnabled: process.env.AGENT_RUNNER_ENABLED === 'true',
  agentRunnerImage: process.env.AGENT_RUNNER_IMAGE ?? 'aisha/plugin-exec:v1',
  brokerTokenSecret: process.env.BROKER_TOKEN_SECRET ?? '',
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
