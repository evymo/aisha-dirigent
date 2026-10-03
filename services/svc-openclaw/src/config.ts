import { requireEnv } from '@aisha/security';
/**
 * svc-openclaw configuration — explicit env reader.
 *
 * Centralises every `process.env` lookup so the rest of the service treats
 * env as immutable typed config. Required by gates:
 *   - service-security.gate.test.ts (explicit config reader presence)
 *   - owasp-discovery.gate.test.ts (no scattered raw env reads)
 *
 * The OWASP A10 SSRF guard pulls `outboundHostAllowlist` from
 * OPENCLAW_OUTBOUND_HOSTS env (comma-separated). Defaults intentionally
 * tight — only the AISHA llm-gateway internal hostname + PostgREST. Add
 * extra entries explicitly via Coolify env if a future use case needs
 * outbound to additional hosts.
 */
export const config = {
  /** Service identity */
  service: 'svc-openclaw' as const,

  /** Listener */
  port: parseInt(process.env.PORT ?? '5210', 10),
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** Service-side bearer used by AISHA callers (svc-ai-chat). */
  apiKey: process.env.OPENCLAW_API_KEY ?? '',

  /** CORS allowlist — comma-separated origins. Empty default means
   *  CORS is effectively closed (only same-origin), which is correct
   *  for an internal service. */
  corsAllowlist: process.env.OPENCLAW_CORS_ALLOWLIST ?? '',

  /** Global rate-limit knob (per-IP). Per-route limits via @aisha/security
   *  helpers if added later. */
  rateLimitMax: parseInt(process.env.OPENCLAW_RATE_LIMIT_MAX ?? '120', 10),

  /** AISHA llm-gateway — used by /api/plan. Empty value triggers the
   *  deterministic manual_review fallback (degrades gracefully). */
  llmGatewayUrl: process.env.AISHA_LLM_GATEWAY_URL ?? '',
  llmGatewayKey: process.env.AISHA_LLM_GATEWAY_KEY ?? '',
  plannerTimeoutMs: parseInt(process.env.PLANNER_TIMEOUT_MS ?? '45000', 10),
  plannerModel: process.env.PLANNER_MODEL ?? 'claude-sonnet-4-20250514',

  /** PostgREST — used by /api/notify to enqueue via RPC. */
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-openclaw', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceJwt: process.env.POSTGREST_SERVICE_JWT ?? '',
  notifyTimeoutMs: parseInt(process.env.NOTIFY_TIMEOUT_MS ?? '15000', 10),

  /**
   * OWASP A10 — outbound host allowlist for safeFetch (comma-separated).
   * The daemon only legitimately reaches:
   *   - aisha llm-gateway (in-cluster `llm-gateway:4000` or an operator
   *     supplied public host when AISHA_LLM_GATEWAY_URL is set externally)
   *   - aisha postgrest (`postgrest:3000` mesh-internal)
   * Extend deliberately if a future capability needs an additional host.
   */
  outboundHostAllowlist: (
    process.env.OPENCLAW_OUTBOUND_HOSTS ??
    'llm-gateway,postgrest'
  )
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),

  /** Allow http:// scheme + RFC1918 internal targets — required for
   *  in-cluster service-to-service (llm-gateway:4000, postgrest:3000).
   *  External destinations remain https-only. */
  allowInternalNetworks: true,
} as const;

/**
 * Defensive bootstrap check — daemon refuses to listen without the
 * service-side bearer. Calls from svc-ai-chat are service-role-only.
 */
export function validateConfigOrExit(): void {
  if (!config.apiKey) {
    process.stderr.write('[svc-openclaw] FATAL: OPENCLAW_API_KEY is not set\n');
    process.exit(2);
  }
}
