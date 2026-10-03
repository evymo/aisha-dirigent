import { spawn } from 'node:child_process';
import { mkdir, rm, cp, chmod, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { dockerJSON, dockerRequest, dockerStart } from './docker-http.js';
import { assertImageAllowed } from './image-guard.js';
import type { RunInput, RunResult, RunnerBackend } from './index.js';

function runCmd(cmd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
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

function parseMemoryLimit(limit: string): number {
  const m = limit.match(/^(\d+)([kmg]?)$/i);
  if (!m) return 256 * 1024 * 1024;
  const val = parseInt(m[1] ?? '0', 10);
  switch ((m[2] ?? '').toLowerCase()) {
    case 'k': return val * 1024;
    case 'm': return val * 1024 * 1024;
    case 'g': return val * 1024 * 1024 * 1024;
    default: return val;
  }
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

// ── Shared cleanup ──────────────────────────────────────────────────────────
export async function removeWorktree(worktree: string): Promise<void> {
  if (!config.agentRepoPath) return;
  await runCmd('git', ['-C', config.agentRepoPath, 'worktree', 'remove', '--force', worktree]);
  await rm(worktree, { recursive: true, force: true }).catch(() => {});
}

export async function killContainer(containerId: string): Promise<void> {
  await dockerRequest('DELETE', `/${config.dockerApiVersion}/containers/${containerId}?force=true`).catch(() => {});
}

/** Prune stale git worktree registry entries (clears collisions left by a crashed
 *  run so a future same-path/branch `worktree add` doesn't fail). */
export async function pruneWorktrees(): Promise<void> {
  if (!config.agentRepoPath) return;
  await runCmd('git', ['-C', config.agentRepoPath, 'worktree', 'prune']);
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

/** Build the container env + bind list, fully config-driven (no literals). */
function buildEnvAndBinds(input: RunInput, prompt: string, branch: string, worktree: string): { env: string[]; binds: string[] } {
  const inputs = input.inputs ?? {};
  const env: string[] = [
    `RUN_ID=${input.runId}`,
    `BROKER_URL=${input.brokerUrl}`,
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
  if (config.netbirdEnabled && input.netbirdSetupKey) {
    env.push(`NB_SETUP_KEY=${input.netbirdSetupKey}`, `NB_MANAGEMENT_URL=${config.netbirdApiUrl}`);
  }

  // ── Auth (E5) — order for a CLI run: 1) SUBSCRIPTION (the CLI's point, NO API
  // key/credits): CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`) and/or ~/.claude
  // mount; 2) LOCAL LLM (Anthropic-compatible endpoint); 3) API KEY (last resort).
  const hasOauth = Boolean(config.agentClaudeOauthToken);
  const hasCreds = Boolean(config.claudeHomeHostPath);
  const hasSubscription = hasOauth || hasCreds;
  const hasLocalLlm = Boolean(config.localLlmBaseUrl);
  const requested = String(inputs.auth_mode ?? config.agentAuthMode);
  const authMode =
    requested === 'subscription' || requested === 'local_llm' || requested === 'api_key'
      ? requested
      : hasSubscription ? 'subscription' : hasLocalLlm ? 'local_llm' : 'api_key';

  const binds = [`${worktree}:/work:rw`];
  if (authMode === 'subscription') {
    optional('CLAUDE_CODE_OAUTH_TOKEN', config.agentClaudeOauthToken);
    if (hasCreds) binds.push(`${config.claudeHomeHostPath}:/home/agent/.claude:ro`);
    optional('ANTHROPIC_BASE_URL', config.anthropicBaseUrl);
    optional('CLAUDE_MODEL', config.claudeModel);
  } else if (authMode === 'local_llm') {
    env.push(`ANTHROPIC_BASE_URL=${config.localLlmBaseUrl}`, 'ANTHROPIC_API_KEY=local-llm');
    optional('CLAUDE_MODEL', config.localLlmModel || config.claudeModel);
  } else {
    optional('ANTHROPIC_BASE_URL', config.anthropicBaseUrl);
    optional('ANTHROPIC_API_KEY', config.anthropicApiKey);
    optional('CLAUDE_MODEL', config.claudeModel);
  }
  return { env, binds };
}

/** Write the story context (CLAUDE.md brief + .aisha/story.json) into the worktree
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
  await mkdir(join(worktree, '.aisha'), { recursive: true }).catch(() => {});
  await writeFile(join(worktree, '.aisha', 'story.json'), JSON.stringify(story, null, 2)).catch(() => {});
  // Append the brief to the worktree's CLAUDE.md (ephemeral per-run copy — does
  // NOT touch the repo) so the agent sees ruleset + story together.
  const brief = String(inputs.story_brief ?? inputs.acceptance_criteria ?? '');
  if (brief) {
    const header = `\n\n## Current task — AISHA story ${inputs.story_id ?? ''} (run ${input.runId})\n\n${brief}\n`;
    await appendFile(join(worktree, 'CLAUDE.md'), header).catch(() => {});
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
 * needs a writable tree). CapDrop ALL + no-new-privileges are retained.
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
    if (!config.agentRepoPath) throw new Error('AGENT_REPO_PATH is not configured');

    const branch = input.branch || String(inputs.branch ?? `aisha/run-${input.runId}`);
    const baseRef = String(inputs.base_ref ?? 'HEAD');
    const worktree = input.worktreeHostPath || join(config.agentRunsDir, input.runId);

    await mkdir(config.agentRunsDir, { recursive: true });
    const add = await runCmd('git', ['-C', config.agentRepoPath, 'worktree', 'add', '-B', branch, worktree, baseRef]);
    if (add.code !== 0) throw new Error(`git worktree add failed: ${add.err.slice(0, 300)}`);

    try {
      await chmod(worktree, 0o777).catch(() => {});
      // Seed the supervision overlay so the relay auto-monitors (fail-open).
      await cp(join(config.agentRepoPath, '.claude'), join(worktree, '.claude'), { recursive: true }).catch(() => {});
      // E13: inject the story brief + .aisha/story.json.
      await injectStoryContext(worktree, input, branch);

      const { env, binds } = buildEnvAndBinds(input, prompt, branch, worktree);
      const runtime = runtimeForProfile(input.profile);
      const created = await dockerJSON<{ Id: string }>('POST', `${apiBase}/containers/create`, {
        Image: input.image,
        WorkingDir: '/work',
        // Jen exec síť — `aisha-network` byla jméno sítě jiné instance (viz backends/docker.ts).
        NetworkingConfig: { EndpointsConfig: { [config.dockerExecNetwork]: {} } },
        HostConfig: {
          NetworkMode: config.dockerExecNetwork,
          Binds: binds,
          Memory: parseMemoryLimit(input.memoryLimit ?? config.execMemoryLimit),
          CpuQuota: config.execCpuQuota,
          CpuPeriod: config.execCpuPeriod,
          SecurityOpt: ['no-new-privileges:true'],
          ReadonlyRootfs: false, // code-editing agent needs a writable rootfs; isolation = container/VM + worktree
          CapDrop: ['ALL'],
          AutoRemove: false,
          ...(runtime ? { Runtime: runtime } : {}),
        },
        // Labels make orphans findable+reapable across runner restarts (the
        // in-memory RUNNING map is process-local and empty after a restart).
        Labels: {
          'aisha.run_id': input.runId,
          'aisha.kind': 'claude_cli_task',
          'aisha.managed_by': 'svc-agent-runner',
        },
        Env: env,
      });
      const containerId = created.Id;
      await dockerStart(apiBase, containerId);
      const ctx: RunningCtx = { runId: input.runId, containerId, worktree, startedAt, host, timeoutMs: input.timeoutMs };
      RUNNING.set(input.runId, ctx);
      return ctx;
    } catch (e) {
      await removeWorktree(worktree);
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
      await removeWorktree(ctx.worktree);
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
    await removeWorktree(ctx.worktree);
    return true;
  }
}
