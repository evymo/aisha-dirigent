import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRunnerOperator, verifyToken } from '../auth.js';
import { rpcService } from '../db.js';
import { config } from '../config.js';
import { issueBrokerToken } from '../broker-token.js';
import { DockerBackend } from '../backends/docker.js';
import { KataBackend } from '../backends/kata.js';
import { ClaudeCliBackend } from '../backends/claude-cli.js';
import { validateClaudeResult, buildRunOutputs } from '../backends/claude-result.js';
import type { RunnerBackend } from '../backends/index.js';
import { getRunnerCaps } from '../runtime-config.js';
import { odregistrujBeh, payloadDoEnv, registrujBeh } from '../broker-proxy.js';
import { souhrnChyby } from '../chyba-behu.js';

/** Kde běh poběží (`<backend>@<kontejner>`) — jedno místo pro všechny zápisy stavu běhu. */
function hostBehu(): string {
  return config.runnerBackend + '@' + (process.env.HOSTNAME ?? 'unknown');
}

function getBackend(profile: string): RunnerBackend {
  if (profile === 'kata-firecracker' || profile === 'kata-dragonball') return new KataBackend();
  if (config.runnerBackend === 'kata') return new KataBackend();
  return new DockerBackend();
}

/** Tolerantly pull the run uuid out of a scalar-returning RPC result. */
function firstRunId(r: unknown): string | undefined {
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) {
    const f = r[0];
    if (typeof f === 'string') return f;
    if (f && typeof f === 'object') return Object.values(f).find((v) => typeof v === 'string') as string | undefined;
  }
  if (r && typeof r === 'object') return Object.values(r).find((v) => typeof v === 'string') as string | undefined;
  return undefined;
}

interface RunRequestBody {
  kind?: string;
  profile?: string;
  image?: string;
  source?: string;
  source_ref?: string;
  payload?: Record<string, unknown>;
  timeout_ms?: number;
}

interface AgentRunRow {
  id: string;
  kind: string;
  profile: string;
  status: string;
  source: string;
  source_ref: string | null;
  outputs_s3_uri: string | null;
  exit_code: number | null;
  error_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);
    requireRunnerOperator(user);
    const body = req.body as RunRequestBody | null;
    if (!body?.kind || !body.source) {
      return reply.status(400).send({ error: 'kind and source are required' });
    }

    const isClaude = body.kind === 'claude_cli_task';
    // claude_cli_task may default its image from config (AGENT_CLAUDE_IMAGE).
    const image = body.image || (isClaude ? config.agentClaudeImage : '');
    if (!image) {
      return reply.status(400).send({ error: 'image is required' });
    }

    // Dynamic runner caps (system_config → env → fail-safe) for the claude path —
    // timeout ceiling, per-container memory and the concurrency cap are all tunable
    // at runtime, not baked. Resolved once per request.
    const caps = isClaude ? await getRunnerCaps() : null;

    const profile = body.profile ?? (isClaude ? 'kata-dragonball' : 'docker');
    // Long-running CLI tasks get their own (much larger) timeout ceiling.
    const timeoutCeiling = isClaude ? caps!.cliTimeoutMs : config.maxTimeoutMs;
    const timeoutDefault = isClaude ? caps!.cliTimeoutMs : config.defaultTimeoutMs;
    const timeoutMs = Math.min(body.timeout_ms ?? timeoutDefault, timeoutCeiling);

    const validKinds = ['plugin-exec', 'workflow-exec', 'repo-agent', 'doc-agent', 'claude_cli_task'] as const;
    const validProfiles = ['docker', 'kata-firecracker', 'kata-dragonball'] as const;

    if (!validKinds.includes(body.kind as (typeof validKinds)[number])) {
      return reply.status(400).send({ error: 'Invalid kind. Must be one of: ' + validKinds.join(', ') });
    }
    if (!validProfiles.includes(profile as (typeof validProfiles)[number])) {
      return reply.status(400).send({ error: 'Invalid profile. Must be one of: ' + validProfiles.join(', ') });
    }

    let runId: string | undefined;
    if (isClaude) {
      // Story-scoped admission + inputs (prompt/story/branch) persisted by the RPC.
      const spawned = await rpcService<unknown>('fn_spawn_claude_cli_run', {
        p_image: image,
        p_inputs: body.payload ?? {},
        p_profile: profile,
        p_source: body.source,
        p_source_ref: body.source_ref ?? null,
      });
      runId = firstRunId(spawned);
    } else {
      // enqueue_agent_run RETURNS uuid → PostgREST answers a bare JSON string, not
      // [{id}]. `runIds[0]?.id` read the first CHARACTER's `.id` → undefined → 500
      // "Failed to create run record" for every plugin run, while the row itself
      // was created and stayed 'queued' (measured 2026-09-28: 7+7 orphans).
      const enqueued = await rpcService<unknown>('enqueue_agent_run', {
        p_image: image,
        p_kind: body.kind,
        p_profile: profile,
        p_source: body.source,
        p_source_ref: body.source_ref ?? null,
      });
      runId = firstRunId(enqueued);
    }
    if (!runId) return reply.status(500).send({ error: 'Failed to create run record' });

    // Admission hold (claude_cli_task): fn_spawn_claude_cli_run creates the run HELD
    // (approval_required + approved_at IS NULL) when fn_admit_clow returns 'ask'. This
    // SYNCHRONOUS executor must NOT run a held row — it waits for approve_claude_run,
    // exactly like claim_queued_claude_run's filter on the poller path. Without this,
    // POST /runs would structurally bypass the approval gate the feature enforces.
    if (isClaude) {
      const held = await rpcService<Array<{ approval_required?: boolean; approved_at?: string | null; awaiting?: string | null }>>(
        'get_agent_run', { p_run_id: runId },
      ).then((rows) => rows?.[0]).catch(() => undefined);
      if (held?.approval_required && !held.approved_at) {
        app.log.info({ run_id: runId, awaiting: held.awaiting }, 'claude_cli_task held pending approval — not running');
        return reply.status(202).send({ run_id: runId, status: 'held', awaiting: held.awaiting ?? 'approval' });
      }
    }

    // Tenant jen u plugin-exec a jen ve tvaru UUID — ostatní druhy běhu ho nemají
    // a nečitelná hodnota se nepředá (broker by jinak hledal konfiguraci naslepo).
    const tenantZPayloadu = body.kind === 'plugin-exec' ? String(body.payload?.['tenant_id'] ?? '') : '';
    const tenantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantZPayloadu) ? tenantZPayloadu : '';
    const brokerToken = await issueBrokerToken(
      { sub: runId, kind: body.kind, source_ref: body.source_ref ?? '', user_id: user.userId, tenant_id: tenantId },
      timeoutMs,
    );

    // Payload sandboxového běhu: do ENV jen malý, větší podrží runner a vydá přes proxy
    // (proxy je povinná, takže doručit jde vždy — viz broker-proxy.ts payloadDoEnv).
    const rozdeleni = isClaude ? undefined : payloadDoEnv(JSON.stringify(body.payload ?? {}));
    const payloadEnv = rozdeleni?.env;
    const payloadMimoEnv = rozdeleni?.mimoEnv;

    await rpcService('update_agent_run_status', {
      p_host: hostBehu(),
      p_run_id: runId,
      p_status: 'running',
    });

    // ⛔ Klíč k mesh síti se pro běh NERAZÍ (2026-10-06, majitel „síť zavřít“ = volba A).
    // Dřív se tu pro KAŽDÝ běh razil klíč NetBirdu a šel do prostředí kontejneru, kde ho
    // nikdo nepoužil — jen ležel na dosah pluginu, který vystoupí z VM. Jediná cesta ven
    // z běhu je broker-proxy runneru v uzavřené síti běhů (broker-proxy.ts).
    const runInput = {
      runId,
      kind: body.kind,
      image,
      brokerToken,
      payload: body.payload ?? {},
      payloadEnv,
      timeoutMs,
      profile,
      ...(isClaude ? { inputs: body.payload ?? {}, branch: body.source_ref ?? undefined, memoryLimit: caps!.execMemoryLimit } : {}),
    };
    // Proxy pustí jen token běhu, který právě běží; finalize ho zase odebere.
    registrujBeh(brokerToken, payloadMimoEnv);

    const finalize = async (
      status: string,
      exitCode: number,
      host: string,
      errSummary: string | null,
      outputs: Record<string, unknown> | null = null,
    ): Promise<void> => {
      odregistrujBeh(brokerToken);
      await rpcService('update_agent_run_status', {
        p_error_summary: errSummary, p_exit_code: exitCode, p_host: host, p_outputs: outputs, p_run_id: runId, p_status: status,
      }).catch(() => {});
    };

    if (isClaude) {
      // ── ASYNC: a Claude CLI task is long-running. Start the container, return
      // 202 immediately, and monitor it in the background (no HTTP block). The
      // run is cancellable mid-flight (ClaudeCliBackend.cancel). Status + live
      // activity surface via get_agent_run + the supervisor relay.
      // Same host concurrency cap as the poller (DYNAMIC, from system_config) —
      // POST /runs is a SECOND executor (n8n fan-out / retries) that would
      // otherwise bypass the cap entirely.
      if (ClaudeCliBackend.activeCount() >= caps!.maxConcurrent) {
        await finalize('failed', -1, runInput.image, 'host at max concurrent claude runs');
        return reply.status(429).send({ error: 'At capacity', run_id: runId, cap: caps!.maxConcurrent });
      }
      const cli = new ClaudeCliBackend();
      let ctx;
      try {
        ctx = await cli.prepare(runInput);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Spawn error';
        app.log.error({ run_id: runId, error: message }, 'claude_cli_task spawn failed');
        await finalize(message.includes('timeout') ? 'timeout' : 'failed', -1, runInput.image, message.slice(0, 500));
        return reply.status(500).send({ error: 'Spawn failed', detail: message, run_id: runId });
      }
      const host = hostBehu();
      const storyId = (runInput.inputs as Record<string, unknown> | undefined)?.['story_id'];
      void cli.monitor(ctx)
        .then(async (result) => {
          // Result-format contract (see backends/claude-result.ts): succeeded only
          // if the container exited 0 AND emitted a well-formed `__result` sentinel;
          // the structured result + a log tail land in agent_runs.outputs.
          const validated = validateClaudeResult(result.result);
          const succeeded = result.exitCode === 0 && validated.valid;
          const outputs = buildRunOutputs(validated, result.logs);
          const errSummary = succeeded ? null : validated.valid ? 'Exit code ' + result.exitCode : validated.reason;
          await finalize(succeeded ? 'succeeded' : 'failed', result.exitCode, result.host, errSummary, outputs);
          // Hermes reflexive-learning loop (E3/E15): evaluate_story_self (advisory,
          // refreshes story_goal_state) + capture learning + synthesize gated
          // improvement_proposals for actionable findings (risk/auto-approve governed
          // inside fn_create_improvement_proposal). Best-effort, NEVER swallowed.
          if (succeeded && typeof storyId === 'string' && storyId) {
            await rpcService('fn_hermes_learning_loop', { p_run_id: runId, p_story_id: storyId }).catch((err: unknown) =>
              app.log.warn(
                { run_id: runId, story_id: storyId, error: err instanceof Error ? err.message : String(err) },
                'hermes learning loop failed (advisory)',
              ),
            );
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Monitor error';
          app.log.error({ run_id: runId, error: message }, 'claude_cli_task monitor failed');
          return finalize(message.includes('timeout') ? 'timeout' : 'failed', -1, host, message.slice(0, 500));
        });
      return reply.status(202).send({ run_id: runId, status: 'running' });
    }

    // ── SYNC: short-lived sandboxed workloads (plugin/workflow/repo/doc-agent).
    try {
      const result = await getBackend(profile).execute(runInput);
      await finalize(result.exitCode === 0 ? 'succeeded' : 'failed', result.exitCode, result.host, result.exitCode === 0 ? null : souhrnChyby(result.exitCode, result.logs));
      return reply.status(200).send({
        run_id: runId,
        status: result.exitCode === 0 ? 'succeeded' : 'failed',
        exit_code: result.exitCode,
        result: result.result,
        schedules: result.schedules ?? [],
        logs: result.logs,
        duration_ms: result.durationMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Execution error';
      const isTimeout = message.includes('timeout');
      app.log.error({ run_id: runId, error: message }, 'Agent run failed');
      await finalize(isTimeout ? 'timeout' : 'failed', -1, hostBehu(), message.slice(0, 500));
      return reply.status(500).send({ error: isTimeout ? 'Execution timeout' : 'Execution failed', detail: message, run_id: runId });
    }
  });

  app.get('/runs/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);
    requireRunnerOperator(user);
    const params = req.params as { id: string };
    const rows = await rpcService<AgentRunRow[]>('get_agent_run', { p_run_id: params.id });
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: 'Run not found' });
    return reply.send(row);
  });

  app.get('/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);
    requireRunnerOperator(user);
    const query = req.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);
    const rows = await rpcService<AgentRunRow[]>('list_agent_runs', { p_limit: limit, p_offset: offset });
    return reply.send({ runs: rows, limit, offset });
  });

  app.post('/runs/:id/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await verifyToken(req.headers.authorization);
    requireRunnerOperator(user);
    const params = req.params as { id: string };
    // Real control: terminate a live claude_cli_task container + remove its
    // worktree (E9), then flip the DB status. A non-claude run (or one not
    // in-flight here) just gets the DB state transition.
    const killed = await ClaudeCliBackend.cancel(params.id).catch(() => false);
    const cancelled = await rpcService<boolean>('cancel_agent_run', { p_run_id: params.id });
    if (!cancelled && !killed) return reply.status(404).send({ error: 'Run not found or already terminal' });
    return reply.send({ cancelled: true, container_killed: killed });
  });
}
