import { requireEnv } from '@aisha/security';
import { dockerApiSegment } from './docker-api-verze.js';
import { celeKladneCislo, uzivatelBehu } from './config-validace.js';
export const config = {
  port: parseInt(process.env.SVC_AGENT_RUNNER_PORT ?? '3030', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-agent-runner', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'svc-agent-runner', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'svc-agent-runner', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  get jwksUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  pluginBrokerUrl: process.env.PLUGIN_BROKER_URL ?? 'http://svc-plugin-system:3029',
  brokerTokenSecret: process.env.BROKER_TOKEN_SECRET ?? '',

  /**
   * Broker-proxy (rozhodnutí majitele 2026-10-01, varianta C): sandbox běhu NENÍ
   * v meshi, takže na `PLUGIN_BROKER_URL` (jméno v meshi) nedosáhne. Runner, který
   * v meshi je, se připojí k exec síti pod tímhle aliasem a přepošle jen `/sandbox/*`.
   * Alias nese identitu instance (`<prefix>-plugin-broker`).
   *
   * ⛔ 2026-10-06 (majitel „síť zavřít“ = volba A): proxy je POVINNÁ. Síť běhů je
   * `Internal: true` — přímá cesta na `PLUGIN_BROKER_URL` z ní nevede, takže „proxy
   * vypnutá → běh dostane broker přímo“ by byl tichý výpadek. Chybějící alias = runner
   * nenastartuje. Proxy je zároveň JEDINÁ cesta ven z běhu (CONNECT pro claude_cli_task).
   */
  brokerProxyAlias: requireEnv('BROKER_PROXY_ALIAS', {
    service: 'svc-agent-runner',
    why: 'Broker-proxy je jediná cesta z uzavřené sítě běhů; alias nese identitu instance (compose stacku exec).',
  }),
  brokerProxyPort: celeKladneCislo('BROKER_PROXY_PORT', 3031, 65535),
  brokerProxyBodyLimit: celeKladneCislo('BROKER_PROXY_BODY_LIMIT', 10 * 1024 * 1024),

  runnerBackend: (process.env.RUNNER_BACKEND ?? 'docker') as 'docker' | 'kata',

  dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  // Segment cesty (`v1.45`); env smí nést i zápis Dockeru bez „v“ — viz docker-api-verze.ts.
  dockerApiVersion: dockerApiSegment(process.env.DOCKER_API_VERSION ?? 'v1.46'),
  // Síť běhů. Runner ji zakládá jako `Internal: true` (bez výchozí trasy ven) a před
  // KAŽDÝM během měří: existující síť toho jména, která uzavřená není, odmítne — nikdy
  // ji tiše nepoužije (backends/docker-http.ts ensureExecNetwork).
  dockerExecNetwork: process.env.DOCKER_EXEC_NETWORK ?? 'aisha-exec-net',
  // Per-container RAM reservation. 256m OOMs a real Claude run; 2g is the runaway
  // multiplier when many run at once. 1g is the honest middle: with
  // MAX_CONCURRENT_CLAUDE_RUNS the host budget = this × that, operator-visible.
  execMemoryLimit: process.env.EXEC_MEMORY_LIMIT ?? '1g',
  execCpuQuota: parseInt(process.env.EXEC_CPU_QUOTA ?? '50000', 10),
  execCpuPeriod: parseInt(process.env.EXEC_CPU_PERIOD ?? '100000', 10),

  kataGrpcEndpoint: process.env.KATA_GRPC_ENDPOINT ?? '',

  // ── Meze kontejneru běhu (svc-agent-runner vynucuje, ne obraz) ──
  // ⛔ 2026-10-06 (majitel „síť zavřít“, volba A): strop procesů a uživatel jdou do
  // KAŽDÉHO požadavku na kontejner běhu — obraz je jen tvrzení. Uživatel je ČÍSELNÝ
  // a ne 0: jméno („node“) by si obraz mohl ve svém /etc/passwd namapovat na root.
  // Nečitelná hodnota = služba NENASTARTUJE (neznámý bezpečnostní přepínač = fail-closed).
  /** Strop procesů/vláken běhu pluginu (plugin-exec, workflow-exec, …). */
  execPidsLimit: celeKladneCislo('EXEC_PIDS_LIMIT', 128),
  /** Strop procesů/vláken běhu claude_cli_task (Claude Code + git + npm). */
  claudePidsLimit: celeKladneCislo('CLAUDE_PIDS_LIMIT', 1024),
  /** Uživatel běhu pluginu — uid[:gid]; výchozí = `USER node` obrazu plugin-exec. */
  execRunUser: uzivatelBehu('EXEC_RUN_USER', '1000'),
  /** Uživatel běhu claude_cli_task — uid[:gid]; výchozí = `useradd -u 10001 agent` v Dockerfile.agent-claude. */
  claudeRunUser: uzivatelBehu('CLAUDE_RUN_USER', '10001'),

  /** Registr balíčků pro běh claude_cli_task (npm) — jeho hostitel jde do výčtu broker-proxy (CONNECT). */
  npmRegistryUrl: process.env.NPM_REGISTRY_URL ?? '',

  defaultTimeoutMs: parseInt(process.env.DEFAULT_TIMEOUT_MS ?? '30000', 10),
  maxTimeoutMs: parseInt(process.env.MAX_TIMEOUT_MS ?? '120000', 10),

  // ── Claude CLI agent runs (kind='claude_cli_task', Component 4 E4) ──
  // Everything env-driven — no hardcoded paths/images/URLs/tokens. Defaults are
  // conventional in-network values; secrets default empty (provided per-host).
  /** Runner-side directory. The child mount is measured from Docker, including Coolify volumes. */
  agentRunsContainerDir: '/var/lib/agent-runs',
  /** Legacy host-path declaration retained for existing bind deployments; not used for child mounts. */
  agentRunsHostDir: process.env.AGENT_RUNS_DIR ?? '',
  /** Default claude agent image ref when a request omits one (else request wins). */
  agentClaudeImage: process.env.AGENT_CLAUDE_IMAGE ?? '',
  /** Per-kind timeout ceiling for a (long-running) Claude CLI task. */
  claudeCliTimeoutMs: parseInt(process.env.CLAUDE_CLI_TIMEOUT_MS ?? '3600000', 10),
  /** Container env injected into a claude run (relay telemetry + LLM routing + git). */
  agentGatewayUrl: process.env.AGENT_GATEWAY_URL ?? process.env.AISHA_GATEWAY_URL ?? '',
  agentMcpToken: process.env.AGENT_MCP_TOKEN ?? process.env.AISHA_MCP_TOKEN ?? '',
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? '',
  // ⛔ Token Claude (AGENT_CLAUDE_OAUTH_TOKEN → v běhu CLAUDE_CODE_OAUTH_TOKEN) ani
  // ANTHROPIC_API_KEY tu NEJSOU (2026-10-02): čtou se v okamžiku běhu z trezoru
  // instance (credentials.ts, administrace „Poskytovatelé AI a tokeny"), aby si každý
  // fork nastavil vlastní token a změna platila bez restartu. Env jen přechodně —
  // při startu se přesune do trezoru (migrateEnvCredentials).
  /** Host path to the agent's ~/.claude directory, bind-mounted read-only into the
   *  run (Linux hosts where the plan creds live in a file; macOS keeps them in the
   *  Keychain). This is a filesystem PATH, not a secret value — hence the non-secret
   *  env name (the mounted directory carries the subscription credential). */
  claudeHomeHostPath: process.env.AGENT_CLAUDE_HOME_DIR ?? '',
  /** Local Anthropic-compatible LLM endpoint + model — the fallback when there is
   *  no subscription/key ("AISHA has no local keys, so it uses what it has"). */
  localLlmBaseUrl: process.env.AGENT_LOCAL_LLM_URL ?? '',
  localLlmModel: process.env.AGENT_LOCAL_LLM_MODEL ?? '',
  /** Auth resolution for a claude run. 'auto' walks: subscription → local LLM →
   *  api_key. Per-run override via inputs.auth_mode. */
  agentAuthMode: (process.env.AGENT_AUTH_MODE ?? 'auto') as
    | 'subscription'
    | 'local_llm'
    | 'api_key'
    | 'auto',
  claudeModel: process.env.AGENT_CLAUDE_MODEL ?? '',
  claudePermissionMode: process.env.AGENT_CLAUDE_PERMISSION_MODE ?? 'acceptEdits',
  /** Git push of the produced branch: opt-in + credentialed remote. */
  agentGitPush: process.env.AGENT_GIT_PUSH === '1',
  /** Repo, které si runner pro KAŽDÝ běh naklonuje do adresáře běhu (sdílený
   *  base-repo s worktrees je pryč: nikdo ho neplnil a :ro mount git worktree add
   *  znemožnil). Bez něj claude_cli_task selže nahlas. */
  agentGitRemote: process.env.AGENT_GIT_REMOTE ?? '',
  agentGitToken: process.env.AGENT_GIT_TOKEN ?? '',
  /** NOTE: the poll/concurrency/memory/timeout knobs below are the ENV BOOTSTRAP
   *  layer only. At runtime they are OVERRIDDEN by system_config('agent_runner')
   *  (see runtime-config.ts getRunnerCaps) so an operator/AISHA tunes them via a DB
   *  row without a redeploy. Env here = the cold-start default before the first
   *  DB read and the fail-safe if the DB is unreachable.
   *
   *  Poller: claim + execute claude_cli_task rows created by fn_spawn (UI/n8n/RPC).
   *  The universal producer→executor link (plan: "spawner naslouchá na agent_runs").
   *  FAIL-SAFE: OFF unless explicitly enabled. An absent/typo'd env var must NEVER
   *  arm a host-wide container spawner — the queue accumulates harmlessly (visible,
   *  alertable) until an operator turns the drain on a sized host. */
  claudePollEnabled: process.env.CLAUDE_POLL_ENABLED === 'true',
  claudePollIntervalMs: parseInt(process.env.CLAUDE_POLL_INTERVAL_MS ?? '5000', 10),
  claudePollGraceSeconds: parseInt(process.env.CLAUDE_POLL_GRACE_SECONDS ?? '10', 10),
  /** Shared token for POST /wake (event-worker forwards 'agent_run_queued' NOTIFYs here
   *  for an immediate claim, atop the safety-net poll). Carried in the WEBHOOK_AGENT_RUNNER
   *  URL query (?token=); the endpoint is internal-mesh only and can only nudge a claim of
   *  already-queued rows, so the token is defence-in-depth. Empty ⇒ no token check. */
  wakeToken: process.env.AGENT_RUNNER_WAKE_TOKEN ?? '',
  /** Hard ceiling on simultaneously-live claude_cli_task containers on THIS host.
   *  Host RAM budget = execMemoryLimit × this. Size it so the product stays under
   *  host RAM minus daemon+OS. `Math.max(1, …)` makes 0/garbage mean 1, never
   *  "unlimited" — the poller refuses to claim and POST /runs returns 429 at cap. */
  maxConcurrentClaudeRuns: Math.max(1, parseInt(process.env.MAX_CONCURRENT_CLAUDE_RUNS ?? '3', 10)),
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** Defence-in-depth container-image allowlist (comma-separated registry/repo
   *  PREFIXES). The operator-role auth boundary is the primary gate; when this is
   *  set, every container the runner launches (POST /runs AND the poller) must
   *  start with an allowed prefix. Empty (default) = no restriction — unchanged
   *  behaviour where "the auth boundary is the only filter". See backends/image-guard.ts. */
  agentImageAllowlist: process.env.AGENT_IMAGE_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

} as const;
