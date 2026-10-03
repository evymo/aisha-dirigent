/**
 * RuntimeAdapter — the EXECUTOR axis (E3).
 *
 * fn_resolve_runtime DERIVES which runtime should execute a clow (direct_llm /
 * openclaw / hermes / cli) from capability-availability. This layer actually RUNS
 * the work through that runtime: each adapter wraps an existing execution surface
 * behind ONE contract, so dispatch is runtime-agnostic.
 *
 *   - direct_llm → the universal LLM executor (the model router, unifiedChat)
 *   - openclaw   → the OpenClaw agent-mesh HTTP API (plan/sandbox/notify)
 *   - hermes     → the Hermes reflexive-learning rail (evaluate_story_self, DB-side)
 *
 * No-fallback contract: executeViaRuntime FAILS LOUD when the derived runtime's
 * adapter is not available in THIS process (config absent / unknown runtime). It
 * never silently downgrades to direct_llm — a runtime that looks chosen but quietly
 * runs as something else masks non-functionality, exactly what the owner rejected.
 */
import { unifiedChat, type LlmProvider } from '../../lib/llmRouter.js';
import { journalDispatch } from '../../lib/dispatchJournal.js';
import { recordExecutionDecision } from '../decision.js';
import { postToOpenclaw } from '../nodes/openclaw.js';
import { rpc } from '../postgrest.js';
import { reflectionConfig as config } from '../config.js';
import { workbenchAdapter } from './workbench-adapter.js';

export interface RuntimeModel {
  provider: string;
  model_id: string;
}

export interface RuntimeWork {
  /** The clow descriptor (purpose, type, needs_* …). */
  clow: Record<string, unknown>;
  /** The work input / prompt / task description. */
  input: string;
  /** The resolved model (from aisha_resolve_clow_backend) — required for direct_llm. */
  model?: RuntimeModel | null;
  /** Story under evaluation — required for hermes. */
  storyId?: string | null;
  /** Free-form execution context (backend override, openclaw path …). */
  context?: Record<string, unknown>;
}

export interface RuntimeResult {
  runtime: string;
  ok: boolean;
  /** Primary textual output of the execution (empty on failure). */
  output: string;
  /** Structured detail (raw provider/runtime payload, error info). */
  detail?: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
}

export interface RuntimeAdapter {
  readonly runtime: string;
  /** Is this adapter wired in THIS process (config/keys present)? */
  isAvailable(): boolean;
  execute(work: RuntimeWork): Promise<RuntimeResult>;
}

// ── direct_llm: the universal LLM executor (wraps the model router) ───────────
export const directLlmAdapter: RuntimeAdapter = {
  runtime: 'direct_llm',
  // The router always exists in-process; per-provider key availability is enforced
  // upstream by the model resolver (serviceable_slugs), not here.
  isAvailable: () => true,
  async execute(work) {
    if (!work.model?.model_id) {
      return {
        runtime: 'direct_llm',
        ok: false,
        output: '',
        detail: { error: 'direct_llm requires a resolved model (provider + model_id)' },
      };
    }
    // I1 — journal the dispatch BEFORE the raw call: every unifiedChat() must
    // mint an ai_decisions row, or fail closed before model execution.
    const decisionId = await journalDispatch({
      model: work.model.model_id,
      provider: work.model.provider as LlmProvider,
      runId: (work.context?.run_id as string) ?? null,
      storyId: work.storyId ?? null,
      runtime: 'direct_llm',
      reason: 'runtime_adapter.direct_llm',
    });
    const res = await unifiedChat({
      provider: work.model.provider as LlmProvider,
      model: work.model.model_id,
      messages: [{ role: 'user', content: work.input }],
    });
    return {
      runtime: 'direct_llm',
      ok: true,
      output: res.text,
      detail: { provider: res.provider, model: res.model, isToolCall: res.isToolCall ?? false, decision_id: decisionId },
      tokensIn: res.usage.inputTokens,
      tokensOut: res.usage.outputTokens,
    };
  },
};

// I1 — every runtime dispatch mints an ai_decisions row BEFORE the side-effect, so an
// admitted (allow-verdict) run cannot execute work without an auditable decision. The
// model-backed runtimes journal a MODEL decision (direct_llm/workbench via journalDispatch,
// cli inside fn_spawn_claude_cli_run); openclaw/hermes resolve no model, so they journal a
// runtime-centric decision through the same fail-closed writer (recordExecutionDecision
// throws when the durable row can't be written — no dispatch without a journal). The
// runtime was already derived by fn_resolve_runtime and cleared by fn_admit_clow upstream,
// hence resolution_source='clow_backend' + admission_verdict='allow'.
async function journalRuntimeDispatch(runtime: 'openclaw' | 'hermes', work: RuntimeWork): Promise<string> {
  return recordExecutionDecision(
    {
      runtime,
      resolution_source: 'clow_backend',
      admission_verdict: 'allow',
      reason: `runtime_adapter.${runtime}`,
    },
    (work.context?.run_id as string) ?? null,
    work.storyId ?? null,
  );
}

// ── openclaw: the agent-mesh HTTP executor (plan/sandbox/notify) ──────────────
export const openclawAdapter: RuntimeAdapter = {
  runtime: 'openclaw',
  isAvailable: () => Boolean(config.enableOpenclaw && config.openclawUrl && config.openclawApiKey),
  async execute(work) {
    // Fail-closed: journal the dispatch BEFORE the outbound side-effect (agent-mesh call).
    const decisionId = await journalRuntimeDispatch('openclaw', work);
    const path = (work.context?.openclaw_path as string) ?? '/api/plan';
    const remote = await postToOpenclaw(path, {
      story_id: work.storyId ?? null,
      task: {
        description: work.input || (work.clow.purpose as string) || '',
        type: (work.clow.type as string) ?? 'general',
      },
      clow: work.clow,
    });
    if (!remote.ok) {
      return {
        runtime: 'openclaw',
        ok: false,
        output: '',
        detail: {
          status: remote.status,
          error: (remote.data as Record<string, unknown>)?.error ?? 'openclaw_failed',
          decision_id: decisionId,
        },
      };
    }
    const data = remote.data as Record<string, unknown> | null;
    return {
      runtime: 'openclaw',
      ok: true,
      output: typeof data?.output === 'string' ? (data.output as string) : JSON.stringify(data ?? {}),
      detail: { status: remote.status, data: data ?? {}, decision_id: decisionId },
    };
  },
};

// ── hermes: the reflexive-learning rail (DB-side, evaluate_story_self) ────────
export const hermesAdapter: RuntimeAdapter = {
  runtime: 'hermes',
  // Hermes is DB-driven (no HTTP service); reachable wherever the RPC layer is.
  isAvailable: () => true,
  async execute(work) {
    if (!work.storyId) {
      return {
        runtime: 'hermes',
        ok: false,
        output: '',
        detail: { error: 'hermes (reflexive learning) requires a storyId to evaluate' },
      };
    }
    // Fail-closed: journal the dispatch before evaluating (audit completeness — I1 holds for
    // every runtime, not just the model-backed ones), then thread the decision_id onto the result.
    const decisionId = await journalRuntimeDispatch('hermes', work);
    const result = await rpc<Record<string, unknown>>('evaluate_story_self', {
      p_story_id: work.storyId,
      p_backend: (work.context?.backend as string) ?? null,
    });
    // evaluate_story_self returns a verdict object whose findings each carry a `summary`; there is
    // no top-level `summary`, so fall back to the serialized verdict rather than an empty output.
    const topSummary = typeof result?.summary === 'string' ? (result.summary as string) : '';
    return {
      runtime: 'hermes',
      ok: true,
      output: topSummary || JSON.stringify(result ?? {}),
      detail: { ...(result ?? {}), decision_id: decisionId },
    };
  },
};

// ── cli: external-CLI driver (enqueues an out-of-process agent run) ───────────
// Unlike the synchronous adapters, the cli runtime is ASYNC + out-of-process: its
// execute() ENQUEUES a claude_cli_task via fn_spawn_claude_cli_run — which composes
// E0 admission (deny refuses, ask holds the run pending approval, allow proceeds)
// and mints the I1 ai_decisions row — then returns the run_id. svc-agent-runner
// drains the queue into an isolated container and the outcome lands in
// agent_runs.outputs. This makes cli a first-class executeViaRuntime target
// (fn_resolve_runtime derives it with an explicit slug) instead of a parallel,
// un-governed enqueue path — the governance lives once, in fn_spawn_claude_cli_run.
export const cliAdapter: RuntimeAdapter = {
  runtime: 'cli',
  // The enqueue RPC is reachable wherever the DB layer is (like hermes). Whether
  // svc-agent-runner is actually draining is the registry adapter_health signal,
  // checked upstream by fn_runtime_available — not duplicated here.
  isAvailable: () => true,
  async execute(work) {
    const cliSlug = (work.clow.cli_slug as string) ?? 'claude-cli';
    const inputs: Record<string, unknown> = {
      prompt: work.input || (work.clow.purpose as string) || '',
      story_id: work.storyId ?? null,
      ...((work.context?.cli_inputs as Record<string, unknown> | undefined) ?? {}),
    };
    try {
      // Returns the new run id, or RAISES on admission deny — fail loud.
      const runId = await rpc<string>('fn_spawn_claude_cli_run', {
        p_cli_slug: cliSlug,
        p_image: (work.context?.image as string) ?? '',
        p_inputs: inputs,
        p_profile: (work.context?.profile as string) ?? 'kata-dragonball',
        p_source: (work.context?.source as string) ?? 'reflection:cli-adapter',
        p_source_ref: (work.context?.branch as string) ?? null,
      });
      return {
        runtime: 'cli',
        ok: true,
        output: typeof runId === 'string' ? runId : String(runId ?? ''),
        detail: { run_id: runId, cli_slug: cliSlug, status: 'enqueued', async: true },
      };
    } catch (err) {
      return {
        runtime: 'cli',
        ok: false,
        output: '',
        detail: { error: String(err).slice(0, 300), cli_slug: cliSlug },
      };
    }
  },
};

// ── registry + dispatch ──────────────────────────────────────────────────────
export const RUNTIME_ADAPTERS: Record<string, RuntimeAdapter> = {
  direct_llm: directLlmAdapter,
  openclaw: openclawAdapter,
  hermes: hermesAdapter,
  workbench: workbenchAdapter,
  cli: cliAdapter,
};

/**
 * Execute work through the DERIVED runtime. Fails loud when the runtime is unknown
 * or its adapter is not available in this process — never downgrades silently.
 */
export async function executeViaRuntime(runtime: string, work: RuntimeWork): Promise<RuntimeResult> {
  const adapter = RUNTIME_ADAPTERS[runtime];
  if (!adapter) {
    throw new Error(`No RuntimeAdapter for runtime '${runtime}' — cannot execute (fail loud, no downgrade)`);
  }
  if (!adapter.isAvailable()) {
    throw new Error(
      `Runtime '${runtime}' adapter is not available in this process (config/keys absent) — failing loud instead of downgrading to direct_llm`,
    );
  }
  return adapter.execute(work);
}

/** Per-runtime adapter availability — feeds the ai_runtime_registry health probe. */
export function runtimeAdapterHealth(): Array<{ runtime: string; available: boolean }> {
  return Object.values(RUNTIME_ADAPTERS).map((a) => ({ runtime: a.runtime, available: a.isAvailable() }));
}
