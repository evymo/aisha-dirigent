import { requireEnv } from '@aisha/security';
import { parseEvalSampleRate } from './lib/evalSampleRate.js';
export const config = {
  port: parseInt(process.env.SVC_AI_CHAT_PORT ?? '3011', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist (comma-separated). */
  ssrfHostAllowlist:
    process.env.SSRF_HOST_ALLOWLIST ??
    'api.openai.com,api.anthropic.com,generativelanguage.googleapis.com',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

  /**
   * Podíl odpovědí chatu, které po uložení ohodnotí LLM soudce (0–1). Přepínač instance
   * (rozhodnutí majitele D8, SELF_IMPROVEMENT_LOOP.md K-17): každé hodnocení = jedno volání
   * modelu navíc. Fail-closed: chybějící nebo neplatná hodnota = 0 (nehodnotí se nic).
   */
  chatEvalSampleRate: parseEvalSampleRate(process.env.CHAT_EVAL_SAMPLE_RATE),

  /** Build SHA stamped onto AITG run records (set by deploy pipeline). */
  buildSha: process.env.GIT_SHA ?? 'dev',

  /** PostgREST endpoint */
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-ai-chat', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  /** Keycloak OIDC.
   *
   * Issuer and JWKS are SEPARATE settings on purpose. A browser token is minted
   * by the PUBLIC IdP URL, so its `iss` carries that hostname; the service must
   * fetch signing keys over the INTERNAL alias, which no browser can reach.
   * Deriving both from one `KEYCLOAK_URL` makes them agree only when service and
   * browser see Keycloak at the same address — never true behind an edge.
   *
   * The gateway already ships this split (services/gateway/src/config.ts) and it
   * is why its own lane verifies browser tokens; svc-ai-chat derived both from
   * `KEYCLOAK_URL` and rejected every browser token with
   * `unexpected "iss" claim value`.
   *
   * Defaults reproduce the previously derived values, so leaving both env vars
   * unset is a no-op.
   */
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-ai-chat', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-ai-chat', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),
  /** Issuer expected in browser tokens (`iss`) — the public IdP URL. */
  kcIssuer:
    process.env.KC_ISSUER ??
    `${requireEnv('KEYCLOAK_URL', { service: 'svc-ai-chat', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' })}/realms/${requireEnv('KEYCLOAK_REALM', { service: 'svc-ai-chat', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' })}`,
  /** Where signing keys are fetched from — the internal URL. */
  kcJwksUrl:
    process.env.KC_JWKS_URL ??
    `${requireEnv('KEYCLOAK_URL', { service: 'svc-ai-chat', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' })}/realms/${requireEnv('KEYCLOAK_REALM', { service: 'svc-ai-chat', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' })}/protocol/openid-connect/certs`,

  /** LLM providers */
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  googleApiKey: process.env.GOOGLE_AI_API_KEY ?? '',

  /** Local LLM backends */
  dockerModelRunnerUrl: process.env.DOCKER_MODEL_RUNNER_URL ?? '',
  ollamaUrl: process.env.OLLAMA_URL ?? '',
  vllmGenerationUrl: process.env.VLLM_GENERATION_URL ?? '',

  /** Insight stack (Alquist) — Ragnarok retrieval + Maestro dialog management */
  ragnarokUrl: process.env.RAGNAROK_URL ?? '',
  ragnarokApiKey: process.env.RAGNAROK_API_KEY ?? '',
  maestroUrl: process.env.MAESTRO_URL ?? '',
  maestroApiKey: process.env.MAESTRO_API_KEY ?? '',
  /** Default language pro Insight retrieval/dialog (BCP-47 tag). Per-call override v opts.lang vyhraje. */
  insightDefaultLang: process.env.INSIGHT_DEFAULT_LANG ?? 'cs-CZ',

  /** n8n / internal services */
  n8nBaseUrl: process.env.N8N_BASE_URL ?? process.env.N8N_WEBHOOK_URL ?? '',
  n8nApiKey: process.env.N8N_API_KEY ?? '',

  /** RabbitMQ for pipeline tasks */
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',

  /** Evaluate AI response endpoint (internal) */
  evaluateAiResponseUrl: process.env.EVALUATE_AI_RESPONSE_URL ?? '',

  /** Chat model prefixes for model listing */
  chatModelPrefixes: (process.env.CHAT_MODEL_PREFIXES ?? 'gpt-,o1-,o3-,o4-').split(',').map((s) => s.trim()),

  /** Omni /v1 dispatch hardening (all env-sourced — no hardcoded literals at call sites). */
  // Fallback output-token cap when the RESOLVED model's ai_model_registry row has no
  // max_output_tokens. The real ceiling is that model's max_output_tokens (dynamic); this is
  // only the conservative floor for unmigrated/NULL-capacity rows — never an unbounded budget.
  omniDefaultMaxOutputTokens: parseInt(process.env.OMNI_DEFAULT_MAX_OUTPUT_TOKENS ?? '4096', 10),
  // Output budget when the client OMITS max_tokens (request-omission default, NOT a cap).
  omniRequestMaxTokensDefault: parseInt(process.env.OMNI_REQUEST_MAX_TOKENS_DEFAULT ?? '1024', 10),
  // Aggregate wall-clock budget (ms) for the tier1/2 dynamic dispatch resolution
  // (derive_clow_needs + aisha_resolve_clow_backend); on expiry the lane degrades to the
  // static-availability fallback instead of hanging ~60s. Admission gets its own budget.
  omniDispatchBudgetMsInteractive: parseInt(process.env.OMNI_DISPATCH_BUDGET_MS_INTERACTIVE ?? '4000', 10),
  omniDispatchBudgetMsHigh: parseInt(process.env.OMNI_DISPATCH_BUDGET_MS_HIGH ?? '8000', 10),
  omniAdmitBudgetMs: parseInt(process.env.OMNI_ADMIT_BUDGET_MS ?? '3000', 10),
  // §11 data-sensitivity registry cache TTL (ms). The svc reads the DB registry
  // (get_data_sensitivity_registry) into a process cache and re-checks staleness
  // on this interval — NEVER on the hot path; a stale miss serves the last
  // snapshot / fail-safe fallback while a background refresh runs. Default 5 min.
  omniSensitivityRegistryTtlMs: parseInt(process.env.OMNI_SENSITIVITY_REGISTRY_TTL_MS ?? '300000', 10),

  // Residency mode: the MINIMUM data sensitivity that forbids cloud LLM providers — the stack runs
  // in one of these modes (per-instance). 'confidential' (default) keeps only PHI/confidential on-prem;
  // 'internal' also keeps internal data on-prem (only public reaches cloud); 'public' forces EVERYTHING
  // local (no cloud LLM at all). Derived from the stack setting, never a hardcoded policy. An admin
  // DB toggle (system_config) overriding this at runtime is a follow-up.
  residencyCloudForbiddenMinSensitivity: (process.env.RESIDENCY_CLOUD_FORBIDDEN_MIN_SENSITIVITY ?? 'confidential').toLowerCase(),

  /** Omni MCP tool execution (PR-B — RFC 8693 token mediation). */
  // Downstream MCP server (svc-mcp-knowledge) base URL. Empty ⇒ the /v1 turn runs tool-less.
  svcMcpKnowledgeUrl: process.env.SVC_MCP_KNOWLEDGE_URL ?? process.env.MCP_SERVICE_URL ?? '',
  // HMAC secret used to MINT the short-lived USER-scoped token forwarded to the MCP server.
  // Same secret PostgREST + svc-mcp-knowledge validate with, so the minted token's
  // auth.uid()=user_id is honoured downstream (RLS) — the PAT is NEVER forwarded, and the
  // minted token is role=authenticated, NEVER service_role.
  postgrestJwtSecret: process.env.JWT_SECRET ?? process.env.POSTGREST_JWT_SECRET ?? '',
} as const;
