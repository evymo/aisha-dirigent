import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { credentials, credentialNameForRuntime } from '../credentials.js';
import { config } from '../config.js';
import { brokerUrlProBeh, povolVystupBehu, proxyUrlProBeh, proxyUrlProKlonRunneru, zajistiCestuKBrokeru } from '../broker-proxy.js';
import { claudeEgressTargets, overVystupBehu, type ZdrojeEgressClaude } from '../egress-policy.js';
import { dockerJSON, dockerRequest, dockerStart, mountyRunneru } from './docker-http.js';
import { assertImageAllowed } from './image-guard.js';
import type { RunInput, RunResult, RunnerBackend } from './index.js';
import { createRunContainer } from './run-container.js';
import { parseMemoryLimit } from './run-container-spec.js';
import { overRunId, pripojeniBehu } from './svazek-behu.js';
import { vetevBehu } from './vetev-behu.js';

function runCmd(cmd: string, args: string[], env?: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, env ? { env: { ...process.env, ...env } } : {});
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

function runtimeForProfile(profile?: string): string | undefined {
  if (profile === 'kata-firecracker') return 'kata-fc';
  if (profile === 'kata-dragonball') return 'kata-dragonball';
  return undefined; // default runc
}

function parseLogs(raw: string): { logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }>; result: unknown } {
  const logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];
  let result: unknown;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const p = JSON.parse(t) as Record<string, unknown>;
      if (p['__result'] === true) result = p['value'];
      else if (p['level'] && p['message']) logs.push({ level: String(p['level']), message: String(p['message']), meta: p['meta'] as Record<string, unknown> | undefined });
      else logs.push({ level: 'info', message: t.slice(0, 2000) });
    } catch {
      logs.push({ level: 'info', message: t.slice(0, 2000) });
    }
  }
  return { logs, result };
}

// ── Cesty a klon běhu ───────────────────────────────────────────────────────
/** Runner works inside its mounted runs directory; Docker supplies the child's source. */
export function cestyBehu(runId: string, cfg: { agentRunsContainerDir: string } = config): { kontejner: string } {
  return { kontejner: join(cfg.agentRunsContainerDir, overRunId(runId)) };
}

/**
 * Klon repa pro jeden běh. Token NIKDY v argumentech (ps) ani v .git/config klonu
 * (ten vidí agent): jde jen do env tohoto procesu jako `http.extraHeader`
 * (GIT_CONFIG_*, git ≥ 2.31). `--filter=blob:none` stáhne historii bez obsahu
 * souborů (rychlé, a base_ref může být větev, tag i commit).
 */
export function klonRepa(remote: string, cil: string, token: string): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: token ${token}`;
  }
  return { args: ['clone', '--filter=blob:none', '--no-checkout', '--', remote, cil], env };
}

// ── Shared cleanup ──────────────────────────────────────────────────────────
/** Adresář běhu je samostatný klon — úklid je prosté smazání (žádné worktrees). */
export async function removeRunDir(adresar: string): Promise<void> {
  await rm(adresar, { recursive: true, force: true }).catch(() => {});
}

export async function killContainer(containerId: string): Promise<void> {
  await dockerRequest('DELETE', `/${config.dockerApiVersion}/containers/${containerId}?force=true`).catch(() => {});
}

/** List every container this runner manages (by label), across process
 *  generations — the input to the boot-time orphan reconciler. */
export async function listManagedContainers(): Promise<Array<{ id: string; runId: string }>> {
  const filters = encodeURIComponent(JSON.stringify({ label: ['aisha.managed_by=svc-agent-runner'] }));
  const list = await dockerJSON<Array<{ Id: string; Labels?: Record<string, string> }>>(
    'GET',
    `/${config.dockerApiVersion}/containers/json?all=1&filters=${filters}`,
  ).catch(() => [] as Array<{ Id: string; Labels?: Record<string, string> }>);
  return list.map((c) => ({ id: c.Id, runId: c.Labels?.['aisha.run_id'] ?? '' }));
}

/** In-flight runs, keyed by agent_runs.id, so a run can be MONITORED async and
 *  CANCELLED mid-flight (kill container + remove worktree). */
interface RunningCtx {
  runId: string;
  containerId: string;
  worktree: string;
  startedAt: number;
  host: string;
  timeoutMs: number;
}
const RUNNING = new Map<string, RunningCtx>();

export interface RunAuth {
  /** cli:<slug> nástroj běhu (z agent_runs.inputs.cli_slug, který zapisuje fn_spawn). */
  cliSlug: string;
  /** Jméno pověření, které runtime deklaruje (ai_runtime_registry.credential_env_var), nebo null. */
  runtimeCredentialName: string | null;
  /** Jeho hodnota (trezor → přechodně env s varováním), nebo null. */
  runtimeCredential: string | null;
  /** ANTHROPIC_API_KEY — jen pro claude-cli v režimu api_key (poslední možnost). */
  anthropicApiKey: string | null;
}

/** Slug, který nemá jiný zdroj: fn_spawn_claude_cli_run má `p_cli_slug DEFAULT 'claude-cli'`
 *  a běhy zařazené před zápisem cli_slug do vstupů (2026-10-02) jsou proto claude-cli. */
const VYCHOZI_CLI_SLUG_FN_SPAWN = 'claude-cli';

export async function resolveRunAuth(inputs: Record<string, unknown>): Promise<RunAuth> {
  const cliSlug = typeof inputs.cli_slug === 'string' && inputs.cli_slug ? inputs.cli_slug : VYCHOZI_CLI_SLUG_FN_SPAWN;
  const runtimeCredentialName = await credentialNameForRuntime(`cli:${cliSlug}`);
  const jmena = [
    ...(runtimeCredentialName ? [runtimeCredentialName] : []),
    ...(cliSlug === 'claude-cli' ? ['ANTHROPIC_API_KEY'] : []),
  ];
  const hodnoty = jmena.length > 0 ? await credentials.getMany(jmena) : {};
  return {
    cliSlug,
    runtimeCredentialName,
    runtimeCredential: runtimeCredentialName ? hodnoty[runtimeCredentialName] ?? null : null,
    anthropicApiKey: cliSlug === 'claude-cli' ? hodnoty['ANTHROPIC_API_KEY'] ?? null : null,
  };
}

type AuthMode = 'subscription' | 'local_llm' | 'api_key';

/** Auth resolution for a CLI run (E5) — see buildEnvAndBinds for the order. */
function resolveAuthMode(input: RunInput, auth: RunAuth): AuthMode {
  const inputs = input.inputs ?? {};
  const hasOauth = Boolean(auth.runtimeCredential);
  const hasCreds = Boolean(config.claudeHomeHostPath);
  const hasSubscription = hasOauth || hasCreds;
  const hasLocalLlm = Boolean(config.localLlmBaseUrl);
  const requested = String(inputs.auth_mode ?? config.agentAuthMode);
  return requested === 'subscription' || requested === 'local_llm' || requested === 'api_key'
    ? requested
    : hasSubscription ? 'subscription' : hasLocalLlm ? 'local_llm' : 'api_key';
}

/**
 * Výčet cílů výstupu (CONNECT přes broker-proxy) pro tento běh — z adres, které mu runner
 * sám předává (egress-policy.ts).
 * Model podle režimu přihlášení je povinný; bez něj výjimka DŘÍV, než vznikne pracovní strom.
 */
function zdrojeVystupu(authMode: AuthMode): ZdrojeEgressClaude {
  return {
    model: authMode === 'local_llm'
      ? { promenna: 'AGENT_LOCAL_LLM_URL', url: config.localLlmBaseUrl }
      : { promenna: 'ANTHROPIC_BASE_URL', url: config.anthropicBaseUrl },
    volitelne: [
      { promenna: 'AGENT_GATEWAY_URL', url: config.agentGatewayUrl },
      { promenna: 'AGENT_GIT_REMOTE', url: config.agentGitRemote },
      { promenna: 'NPM_REGISTRY_URL', url: config.npmRegistryUrl },
    ],
  };
}

/** Build the container env + bind list, fully config-driven (no literals). */
export function buildEnvAndBinds(
  input: RunInput,
  prompt: string,
  branch: string,
  auth: RunAuth,
  cesta: { brokerUrl: string; proxyUrl: string },
): { env: string[]; binds: string[] } {
  const authMode = resolveAuthMode(input, auth);
  const env: string[] = [
    `RUN_ID=${input.runId}`,
    // Broker jen přes broker-proxy runneru — síť běhů je uzavřená (2026-10-06, volba A).
    `BROKER_URL=${cesta.brokerUrl}`,
    `BROKER_TOKEN=${input.brokerToken}`,
    `EXEC_TIMEOUT_MS=${input.timeoutMs}`,
    `AISHA_RUN_ID=${input.runId}`,
    `AISHA_AGENT_RUN_ID=${input.runId}`,
    'AISHA_WORKTREE=/work',
    `AISHA_PROMPT=${prompt}`,
    `AISHA_BRANCH=${branch}`,
    `CLAUDE_PERMISSION_MODE=${config.claudePermissionMode}`,
    `AISHA_GIT_PUSH=${config.agentGitPush ? '1' : '0'}`,
  ];
  const optional = (k: string, v: string): void => { if (v) env.push(`${k}=${v}`); };
  optional('AISHA_GATEWAY_URL', config.agentGatewayUrl);
  optional('AISHA_MCP_TOKEN', config.agentMcpToken);
  optional('AGENT_GIT_REMOTE', config.agentGitRemote);
  optional('AGENT_GIT_TOKEN', config.agentGitToken);
  optional('npm_config_registry', config.npmRegistryUrl);
  // ── Jediná cesta ven: broker-proxy runneru (CONNECT s tokenem tohoto běhu). Síť běhů
  // nemá výchozí trasu; Claude Code, git i npm proxy z prostředí čtou (obě velikosti písmen).
  // Klíč k mesh síti běh NEDOSTANE (2026-10-06, volba A — dřív tu byl NB_SETUP_KEY).
  env.push(
    `HTTPS_PROXY=${cesta.proxyUrl}`,
    `HTTP_PROXY=${cesta.proxyUrl}`,
    `https_proxy=${cesta.proxyUrl}`,
    `http_proxy=${cesta.proxyUrl}`,
  );

  // ── Auth (E5) — order for a CLI run: 1) SUBSCRIPTION (the CLI's point, NO API
  // key/credits): CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`) and/or ~/.claude
  // mount; 2) LOCAL LLM (Anthropic-compatible endpoint); 3) API KEY (last resort).
  // Resolution (resolveAuthMode): explicit inputs.auth_mode ?? config.agentAuthMode, else auto.
  const hasCreds = Boolean(config.claudeHomeHostPath);

  const binds: string[] = [];
  // ── Jiný CLI nástroj než claude-cli (např. codex-cli): dostane SVÉ pověření pod
  // jménem, které jeho runtime deklaruje (cli:codex-cli → OPENAI_API_KEY, které čte
  // docker/agent-codex). Chybí-li, běh neodstartuje — radši nahlas než běh bez klíče.
  if (auth.cliSlug !== 'claude-cli') {
    if (auth.runtimeCredentialName) {
      if (!auth.runtimeCredential) {
        throw new Error(
          `pověření ${auth.runtimeCredentialName} pro cli:${auth.cliSlug} není nastavené — nastavte ho v administraci (Poskytovatelé AI a tokeny)`,
        );
      }
      env.push(`${auth.runtimeCredentialName}=${auth.runtimeCredential}`);
    }
    return { env, binds };
  }


  if (authMode === 'subscription') {
    optional('CLAUDE_CODE_OAUTH_TOKEN', auth.runtimeCredential ?? '');
    if (hasCreds) binds.push(`${config.claudeHomeHostPath}:/home/agent/.claude:ro`);
    optional('ANTHROPIC_BASE_URL', config.anthropicBaseUrl);
    optional('CLAUDE_MODEL', config.claudeModel);
  } else if (authMode === 'local_llm') {
    env.push(`ANTHROPIC_BASE_URL=${config.localLlmBaseUrl}`, 'ANTHROPIC_API_KEY=local-llm');
    optional('CLAUDE_MODEL', config.localLlmModel || config.claudeModel);
  } else {
    optional('ANTHROPIC_BASE_URL', config.anthropicBaseUrl);
    optional('ANTHROPIC_API_KEY', auth.anthropicApiKey ?? '');
    optional('CLAUDE_MODEL', config.claudeModel);
  }
  return { env, binds };
}

/** Write ephemeral story context (.aisha/run-context.md + .aisha/story.json) into the worktree
 *  so the spawned agent works to the STORY GOAL, not just a bare prompt (E13). */
async function injectStoryContext(worktree: string, input: RunInput, branch: string): Promise<void> {
  const inputs = input.inputs ?? {};
  const story = {
    story_id: inputs.story_id ?? null,
    run_id: input.runId,
    branch,
    goal: inputs.goal ?? inputs.prompt ?? null,
    acceptance_criteria: inputs.acceptance_criteria ?? null,
    context_profile: inputs.context_profile ?? 'default',
    prompt: inputs.prompt ?? null,
  };
  await mkdir(join(worktree, '.aisha'), { recursive: true });
  await writeFile(join(worktree, '.aisha', 'story.json'), JSON.stringify(story, null, 2));
  await appendFile(join(worktree, '.git', 'info', 'exclude'), '\n/.aisha/story.json\n/.aisha/run-context.md\n');
  // The CLI appends this brief to its system prompt; tracked CLAUDE.md remains editable.
  const brief = String(inputs.story_brief ?? inputs.acceptance_criteria ?? '');
  if (brief) {
    const header = `\n\n## Current task — AISHA story ${inputs.story_id ?? ''} (run ${input.runId})\n\n${brief}\n`;
    await writeFile(join(worktree, '.aisha', 'run-context.md'), header);
  }
}

/**
 * Runs a Claude Code CLI task (kind='claude_cli_task') in an isolated container
 * against a per-run git worktree. ASYNC model: prepare() creates the worktree +
 * starts the container (detached) and registers the run; monitor() awaits exit +
 * collects logs + cleans up; cancel() terminates a live run. execute() = the sync
 * convenience (prepare+monitor) kept for the RunnerBackend interface.
 *
 * Isolation: the container/VM boundary (kata-dragonball when profiled) + the
 * per-run worktree replace the plugin path's ReadonlyRootfs (a code-editing agent
 * needs a writable tree). CapDrop ALL + no-new-privileges + PidsLimit + a numeric
 * non-root User come from the single container-spec builder (run-container-spec.ts).
 * Network (2026-10-06, volba A): the run sits on the CLOSED runs network; its only
 * way out is the runner's broker-proxy — `/sandbox/*` to the broker + CONNECT that admits
 * only the hosts derived from this run's own config (model, relay, forge, registry).
 * Every value comes from config — no literals.
 */
export class ClaudeCliBackend implements RunnerBackend {
  /** Create the worktree, inject story context, create + start the container
   *  (detached), and register the run. Returns once the container is started. */
  async prepare(input: RunInput): Promise<RunningCtx> {
    assertImageAllowed(input.image); // defence-in-depth: fail loud before any worktree work
    const startedAt = Date.now();
    const host = `claude-cli@${process.env.HOSTNAME ?? 'unknown'}`;
    const apiBase = `/${config.dockerApiVersion}`;
    const inputs = input.inputs ?? {};
    const prompt = String(inputs.prompt ?? '');
    if (!prompt) throw new Error('claude_cli_task requires inputs.prompt');
    if (!config.agentGitRemote) throw new Error('AGENT_GIT_REMOTE is not configured (repo, které si běh naklonuje)');

    // Cesta ven se rozhoduje DŘÍV, než vznikne pracovní strom: nedeklarovaný model,
    // neuzavřená síť běhů nebo runner mimo ni = běh se nespustí (fail-closed).
    const auth = await resolveRunAuth(inputs);
    const authMode = resolveAuthMode(input, auth);
    const zdroje = zdrojeVystupu(authMode);
    const cile = claudeEgressTargets(zdroje);
    // Táž ochrana SSRF, jakou pak pustí broker-proxy — měřeno TEĎ, s názvem proměnné.
    await overVystupBehu(zdroje);
    await zajistiCestuKBrokeru();

    const branch = vetevBehu(input.runId, input.branch || (typeof inputs.branch === 'string' ? inputs.branch : null));
    const baseRef = String(inputs.base_ref ?? 'HEAD');
    const cesty = cestyBehu(input.runId);
    const worktree = cesty.kontejner;

    const mount = pripojeniBehu(await mountyRunneru(), config.agentRunsContainerDir, input.runId);
    if (mount.Type === 'volume' && (() => { const [major, minor] = config.dockerApiVersion.replace(/^v/, '').split('.').map(Number); return major === 1 && (minor ?? 0) < 45; })()) {
      throw new Error('Docker API >= 1.45 is required for a runs volume subpath');
    }
    // Register before cloning: git uses the same authenticated allowlist as the child.
    povolVystupBehu(input.brokerToken, cile, input.runId);
    const klon = klonRepa(config.agentGitRemote, worktree, config.agentGitToken);
    const proxy = proxyUrlProKlonRunneru(input.brokerToken);
    Object.assign(klon.env, { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NO_PROXY: '', no_proxy: '' });
    let containerId: string | undefined;
    try {
      await mkdir(config.agentRunsContainerDir, { recursive: true });
      const clone = await runCmd('git', klon.args, klon.env);
      if (clone.code !== 0) throw new Error('git clone failed (check the declared forge and runner credential)');
      // base_ref: HEAD = výchozí větev remote; jméno větve se hledá jako origin/<ref>,
      // tag i commit projdou napřímo (klon nese celou historii bez obsahu souborů).
      const vzdalena = baseRef === 'HEAD' ? null : await runCmd('git', ['-C', worktree, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${baseRef}^{commit}`], klon.env);
      const candidate = vzdalena && vzdalena.code === 0 ? `refs/remotes/origin/${baseRef}` : baseRef;
      const resolved = await runCmd('git', ['-C', worktree, 'rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`], klon.env);
      if (resolved.code !== 0) throw new Error('base_ref does not resolve to a commit');
      const odkud = resolved.out.trim();
      const co = await runCmd('git', ['-C', worktree, 'checkout', '-B', branch, odkud], klon.env);
      if (co.code !== 0) throw new Error('git checkout failed');
      // Agent běží pod jiným uid než runner — strom mu musí patřit k zápisu (celý, ne jen kořen).
      const permissions = await runCmd('chmod', ['-R', 'a+rwX', worktree]);
      if (permissions.code !== 0) throw new Error('cannot grant the run user access to its worktree');
      // E13: inject the story brief + .aisha/story.json.
      await injectStoryContext(worktree, input, branch);

      // Docker's measured mount is the same source the runner cloned into.
      const { env, binds } = buildEnvAndBinds(input, prompt, branch, auth, {
        brokerUrl: brokerUrlProBeh(),
        proxyUrl: proxyUrlProBeh(input.brokerToken),
      });
      const runtime = runtimeForProfile(input.profile);
      containerId = await createRunContainer(apiBase, {
        image: input.image,
        workingDir: '/work',
        network: config.dockerExecNetwork,
        binds,
        mounts: [mount],
        user: config.claudeRunUser,
        pidsLimit: config.claudePidsLimit,
        memoryBytes: parseMemoryLimit(input.memoryLimit ?? config.execMemoryLimit),
        cpuQuota: config.execCpuQuota,
        cpuPeriod: config.execCpuPeriod,
        readonlyRootfs: false, // code-editing agent needs a writable rootfs; isolation = container/VM + worktree
        ...(runtime ? { runtime } : {}),
        // Labels make orphans findable+reapable across runner restarts (the
        // in-memory RUNNING map is process-local and empty after a restart).
        labels: {
          'aisha.run_id': input.runId,
          'aisha.kind': 'claude_cli_task',
          'aisha.managed_by': 'svc-agent-runner',
        },
        env,
      });
      await dockerStart(apiBase, containerId);
      const ctx: RunningCtx = { runId: input.runId, containerId, worktree, startedAt, host, timeoutMs: input.timeoutMs };
      RUNNING.set(input.runId, ctx);
      return ctx;
    } catch (e) {
      if (containerId) await killContainer(containerId);
      await removeRunDir(worktree);
      throw e;
    }
  }

  /** Await the container exit, collect logs, and clean up (deregister + rm). */
  async monitor(ctx: RunningCtx): Promise<RunResult> {
    const apiBase = `/${config.dockerApiVersion}`;
    try {
      const waitResult = await Promise.race([
        dockerJSON<{ StatusCode: number }>('POST', `${apiBase}/containers/${ctx.containerId}/wait?condition=not-running`),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Container timeout after ${ctx.timeoutMs}ms`)), ctx.timeoutMs + 5000),
        ),
      ]);
      const logsRes = await dockerRequest('GET', `${apiBase}/containers/${ctx.containerId}/logs?stdout=1&stderr=1`);
      const { logs, result } = parseLogs(logsRes.body);
      return { exitCode: waitResult.StatusCode, result, logs, host: ctx.host, durationMs: Date.now() - ctx.startedAt };
    } finally {
      RUNNING.delete(ctx.runId);
      await killContainer(ctx.containerId);
      await removeRunDir(ctx.worktree);
    }
  }

  /** Sync convenience (RunnerBackend interface): prepare + monitor. */
  async execute(input: RunInput): Promise<RunResult> {
    const ctx = await this.prepare(input);
    return this.monitor(ctx);
  }

  /** Whether a run is currently in-flight (for status/visibility). */
  static isRunning(runId: string): boolean {
    return RUNNING.has(runId);
  }

  /** Number of claude_cli_task containers this process is actively monitoring.
   *  The authoritative live-count for the concurrency cap (poller + POST /runs). */
  static activeCount(): number {
    return RUNNING.size;
  }

  /** Terminate a live claude_cli_task: kill the container + remove the worktree.
   *  Returns true if a running container was found and killed. */
  static async cancel(runId: string): Promise<boolean> {
    const ctx = RUNNING.get(runId);
    if (!ctx) return false;
    RUNNING.delete(runId);
    await killContainer(ctx.containerId);
    await removeRunDir(ctx.worktree);
    return true;
  }
}
