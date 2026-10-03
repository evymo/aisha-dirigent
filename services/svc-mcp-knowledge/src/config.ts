import { requireEnv } from '@aisha/security';
const keycloakUrl = requireEnv('KEYCLOAK_URL', { service: 'svc-mcp-knowledge', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' });
const keycloakRealm = requireEnv('KEYCLOAK_REALM', { service: 'svc-mcp-knowledge', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' });

/** svc-mcp-knowledge configuration */
export const config = {
  port: parseInt(process.env.PORT ?? '3017', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** PostgREST */
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-mcp-knowledge', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),
  postgrestJwtSecret: process.env.JWT_SECRET ?? process.env.POSTGREST_JWT_SECRET ?? '',

  /** Keycloak OIDC */
  keycloakUrl,
  keycloakRealm,
  kcIssuer: process.env.KC_ISSUER ?? `${keycloakUrl}/realms/${keycloakRealm}`,
  jwksUrl: process.env.KC_JWKS_URL ?? `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`,
  kcAllowedClients: (process.env.KC_ALLOWED_CLIENTS ?? 'aisha-app,aisha-dirigent-device')
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean),

  /** OpenAI */
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  // ⛔ `embeddingModel: EMBEDDING_MODEL ?? 'text-embedding-3-small'` tu byl do 2026-09-13:
  // literální model (1536) pro sloupce vector(1024). Embedding model je vlastnost
  // korpusového PROSTORU a vybírá ho resolver (fn_resolve_embedding_model_for_space),
  // ne konfigurace služby — viz lib/embed-query-in-space.ts.

  /** Ragnarok RAG engine */
  ragnarokUrl: process.env.RAGNAROK_URL ?? 'http://ragnarok:9696',
  ragnarokApiKey: process.env.RAGNAROK_API_KEY ?? '',
  ragnarokDefaultProjectId: 'aisha',

  /** Maestro dialog management (Alquist Insight) — debug/service-role proxy.
   *  Standardní cesta z frontendu je svc-ai-chat /story-consult, ne tato MCP route. */
  maestroUrl: process.env.MAESTRO_URL ?? 'http://maestro:8020',
  maestroApiKey: process.env.MAESTRO_API_KEY ?? '',
  maestroDefaultProjectId: process.env.INSIGHT_DEFAULT_PROJECT_ID ?? 'aisha',

  /** Default language pro Insight retrieval/dialog (BCP-47 tag). Per-request
   *  override v body.lang vyhraje. AISHA defaultně preferuje češtinu pro
   *  partner_stories, anglicky odpovídá pokud user query je anglicky. */
  insightDefaultLang: process.env.INSIGHT_DEFAULT_LANG ?? 'cs-CZ',
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

  /** AITG probe service URL (called from MCP aitg_run_test tool). */
  aitgProbesUrl: process.env.AITG_PROBES_SERVICE_URL ?? 'http://svc-aitg-probes:3041',

} as const;
