import { requireEnv } from '@aisha/security';
/** svc-aisha-kronos-shim configuration
 *
 * Soft adapter ("shim") který Maestru poskytuje Kronos-compatible API,
 * ale uvnitř všechno proxuje na existující AISHA logiku:
 *   - project metadata     → mcp_get_story_context (RPC)
 *   - knowledge base list  → get_story_knowledge_context (RPC)
 *   - sessions / turns     → mcp_store_agent_memory + mcp_get_agent_memories (RPC)
 *   - RAG retrieval        → Ragnarok HTTP přímo (skip Kronos KB metadata layer)
 *   - resources/FSM        → static stubs (minimal greeting → query → response FSM)
 *
 * Žádný Mongo, žádný MinIO, žádný Azure. Maestru "vypadá jako Kronos".
 */
export const config = {
  port: parseInt(process.env.PORT ?? '9625', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** PostgREST */
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-aisha-kronos-shim', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  /** API key, který Maestro posílá v hlavičce X-Api-Key (CONFIG.KRONOS_API_KEY).
   *  Shim ho validuje proti vlastnímu env KRONOS_API_KEY (single shared secret). */
  kronosApiKey: process.env.KRONOS_API_KEY ?? '',

  /** Ragnarok HTTP endpoint pro RAG proxy. Maestro neví o Ragnaroku přímo —
   *  shim forwarduje na Ragnarok místo Kronos KB metadata layer. */
  ragnarokUrl: (process.env.RAGNAROK_URL ?? 'http://ragnarok:9696').replace(/\/+$/, ''),
  ragnarokApiKey: process.env.RAGNAROK_API_KEY ?? '',

  /** Default AISHA agent_slug pro session storage v agent_memories. */
  sessionAgentSlug: process.env.INSIGHT_SESSION_AGENT_SLUG ?? 'maestro-dialog',

  /** Default jazyk pro projects (BCP-47). */
  defaultLang: process.env.INSIGHT_DEFAULT_LANG ?? 'cs-CZ',
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
