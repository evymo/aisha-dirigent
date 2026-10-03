import { config } from './config.js';
import { rpcService } from './db.js';
import { issueBrokerToken } from './broker-token.js';
import { ClaudeCliBackend } from './backends/claude-cli.js';
import { validateClaudeResult, buildRunOutputs } from './backends/claude-result.js';
import { createEphemeralKey, revokePeer } from './netbird-client.js';
import { getRunnerCaps, type RunnerCaps } from './runtime-config.js';

/**
 * Claude CLI poller — the producer→executor link. fn_spawn_claude_cli_run (called
 * by the Dirigent UI, n8n, or any RPC caller) creates a `queued` agent_runs row;
 * this loop atomically claims it (claim_queued_claude_run, SKIP LOCKED) and runs
 * it via the async ClaudeCliBackend. So spawning is decoupled from execution — a
 * producer just creates the row, and any runner instance picks it up.
 */
interface ClaimedRun {
  id: string;
  image: string;
  profile: string;
  source: string;
  source_ref: string | null;
  inputs: Record<string, unknown> | null;
}

interface PollerLog {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let stopped = false;
let pollerLog: PollerLog | undefined;  // captured by startClaudePoller for wakeClaudePoller()

/** Claim + start one queued claude run, if any. Returns whether a run was started.
 *  `caps` are the DYNAMICALLY-resolved runner limits (system_config → env). */
export async function pollOnce(log: PollerLog, caps: RunnerCaps): Promise<boolean> {
  // Concurrency cap: refuse to even CLAIM when at capacity. The queued row stays
  // queued and is picked up once a slot frees (RUNNING.size drops as monitors
  // finish) — no row stranded, no unbounded host-level container fan-out. This is
  // the load-bearing guard: inFlight only serializes claiming, not live monitors.
  const active = ClaudeCliBackend.activeCount();
  if (active >= caps.maxConcurrent) {
    log.info({ active, cap: caps.maxConcurrent }, 'claude poller at capacity — skip claim');
    return false;
  }
  const rows = await rpcService<ClaimedRun[]>('claim_queued_claude_run', {
    p_grace_seconds: caps.pollGraceSeconds,
  }).catch((err: unknown) => {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'claim_queued_claude_run failed');
    return [] as ClaimedRun[];
  });
  const run = rows?.[0];
  if (!run) return false;

  const runId = run.id;
  const inputs = run.inputs ?? {};
  const timeoutMs = caps.cliTimeoutMs;
  const host = config.runnerBackend + '@' + (process.env.HOSTNAME ?? 'unknown');
  const storyId = (inputs as Record<string, unknown>)['story_id'];

  let nbKey: string | undefined;
  let nbPeer: string | undefined;
  if (config.netbirdEnabled) {
    const nb = await createEphemeralKey(runId).catch(() => undefined);
    if (nb) { nbKey = nb.setupKey; nbPeer = nb.peerId; }
  }

  const finalize = async (
    status: string,
    exitCode: number,
    h: string,
    err: string | null,
    outputs: Record<string, unknown> | null = null,
  ): Promise<void> => {
    if (config.netbirdEnabled && nbPeer) revokePeer(nbPeer).catch(() => {});
    await rpcService('update_agent_run_status', {
      p_error_summary: err, p_exit_code: exitCode, p_host: h, p_outputs: outputs, p_run_id: runId, p_status: status,
    }).catch(() => {});
  };

  const brokerToken = await issueBrokerToken(
    { sub: runId, kind: 'claude_cli_task', source_ref: run.source_ref ?? '', user_id: 'poller', tenant_id: '' },
    timeoutMs,
  );

  const cli = new ClaudeCliBackend();
  let ctx;
  try {
    ctx = await cli.prepare({
      runId,
      kind: 'claude_cli_task',
      image: run.image || config.agentClaudeImage, // producer may omit image → runner default
      brokerToken,
      brokerUrl: config.pluginBrokerUrl,
      payload: inputs,
      timeoutMs,
      memoryLimit: caps.execMemoryLimit, // dynamic per-container reservation
      netbirdSetupKey: nbKey,
      profile: run.profile,
      inputs,
      branch: run.source_ref ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Spawn error';
    log.error({ run_id: runId, error: message }, 'poller claude spawn failed');
    await finalize(message.includes('timeout') ? 'timeout' : 'failed', -1, host, message.slice(0, 500));
    return true;
  }

  void cli.monitor(ctx)
    .then(async (result) => {
      // Result-format contract: the run succeeded only if the container exited 0
      // AND emitted a well-formed `__result` sentinel. The structured result + a
      // log tail are persisted to agent_runs.outputs (previously parsed-then-discarded,
      // so "succeeded" meant only "exited 0" even on empty/garbage output).
      const validated = validateClaudeResult(result.result);
      const succeeded = result.exitCode === 0 && validated.valid;
      const outputs = buildRunOutputs(validated, result.logs);
      const errSummary = succeeded ? null : validated.valid ? 'Exit code ' + result.exitCode : validated.reason;
      await finalize(succeeded ? 'succeeded' : 'failed', result.exitCode, result.host, errSummary, outputs);
      if (succeeded && typeof storyId === 'string' && storyId) {
        // Hermes reflexive-learning loop (E3/E15): evaluate_story_self (advisory,
        // refreshes story_goal_state) + capture learning + synthesize gated
        // improvement_proposals for actionable findings. Proposal risk/auto-approve
        // is governed inside fn_create_improvement_proposal. Best-effort, but NEVER
        // swallowed — a failure is logged (no-fallback contract).
        await rpcService('fn_hermes_learning_loop', { p_run_id: runId, p_story_id: storyId }).catch((err: unknown) =>
          log.warn(
            { run_id: runId, story_id: storyId, error: err instanceof Error ? err.message : String(err) },
            'hermes learning loop failed (advisory)',
          ),
        );
      }
    })
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Monitor error';
      log.error({ run_id: runId, error: message }, 'poller claude monitor failed');
      await finalize(message.includes('timeout') ? 'timeout' : 'failed', -1, host, message.slice(0, 500));
    });

  return true;
}

export function startClaudePoller(log: PollerLog): void {
  stopped = false;
  pollerLog = log;
  // Self-rescheduling loop (not setInterval) so EVERY tick re-reads the live caps:
  // poll_enabled, interval and the cap can all be tuned in system_config at runtime
  // — flip poll_enabled=false in the DB and draining stops within a tick, no restart.
  log.info({}, 'claude poller started (caps resolved dynamically from system_config)');
  const tick = async (): Promise<void> => {
    if (stopped) return;
    let intervalMs = config.claudePollIntervalMs; // scheduling fallback if caps fetch throws
    try {
      const caps = await getRunnerCaps();
      intervalMs = caps.pollIntervalMs;
      if (caps.pollEnabled && !inFlight) {
        inFlight = true;
        await pollOnce(log, caps).catch(() => false).finally(() => { inFlight = false; });
      }
    } catch (err) {
      log.warn({ error: err instanceof Error ? err.message : String(err) }, 'claude poller tick error');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => { void tick(); }, intervalMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      }
    }
  };
  timer = setTimeout(() => { void tick(); }, config.claudePollIntervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

export function stopClaudePoller(): void {
  stopped = true;
  if (timer) { clearTimeout(timer); timer = undefined; }
}

/**
 * Wake-on-event: run a single claim immediately, out of band from the safety-net
 * tick. Invoked by the /wake route when event-worker forwards an 'agent_run_queued'
 * NOTIFY. Guarded by the same inFlight/caps checks as the tick, so a burst of wakes
 * (or a wake during a running poll) is a no-op — the in-flight poll drains the queue,
 * and the periodic tick remains the safety net if a NOTIFY is ever missed.
 */
export async function wakeClaudePoller(): Promise<void> {
  if (stopped || inFlight || !pollerLog) return;
  const log = pollerLog;
  try {
    const caps = await getRunnerCaps();
    if (!caps.pollEnabled || inFlight) return;  // re-check inFlight after the async caps fetch
    inFlight = true;
    await pollOnce(log, caps).catch(() => false).finally(() => { inFlight = false; });
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'claude wake error');
  }
}
