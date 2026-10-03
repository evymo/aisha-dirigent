import type { NodeHandler } from '../types.js';
import { rpc } from '../postgrest.js';
import type { ClowBackend } from '../decision.js';
import { selectServiceableSlugs } from '../../lib/llmRouter.js';
import { createSafeLogger } from '@aisha/security';

const log = createSafeLogger('svc-ai-chat');

/**
 * openclaw_resolve_clow — call aisha_resolve_clow_backend RPC for the current
 * clow context. Useful inside reflection graphs that fan out per-sub-agent
 * tasks. The resolution.top contains {provider_slug, model_id, backend_kind,
 * strategy} which the next node (typically `generator`) reads via state.
 *
 * Config:
 *   - clow_path (default 'current_clow')   — key into ctx.state for clow descriptor
 *   - constraints (object)                 — merged into the clow descriptor
 *   - soft_fail (default true)             — when no candidate matches, continue with 'unresolved'
 */
export const openclawResolveClow: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const clowPath = (cfg.clow_path as string) ?? 'current_clow';
  const constraints = (cfg.constraints as Record<string, unknown>) ?? {};
  const softFail = (cfg.soft_fail as boolean) ?? true;

  const clow = (ctx.state[clowPath] as Record<string, unknown> | undefined) ?? {};
  const mergedClow = { ...clow, ...constraints };

  // Graph-entry fallback: with no explicit clow in state, derive the purpose from
  // the run's task input (orchestrator seeds state.task = run.metadata.input) so
  // this node can drive a run straight from its task description.
  if (!mergedClow.purpose) {
    const task =
      (ctx.state.task as Record<string, unknown> | undefined) ??
      (ctx.run.metadata.input as Record<string, unknown> | undefined) ??
      {};
    if (typeof task.description === 'string' && task.description) mergedClow.purpose = task.description;
  }

  if (!mergedClow.purpose) {
    return {
      output_data: { error: 'clow.purpose missing in state and config' },
      fatal_error: 'openclaw_resolve_clow needs state.current_clow.purpose, config.constraints.purpose, or run task.description',
    };
  }

  // ── Capability needs: derive needs_write/internet/tools (+ runtime hint) from the
  // task via the SINGLE producer (derive_clow_needs — same one the chooser uses), so
  // fn_resolve_runtime sees REAL needs and can pick openclaw/hermes instead of always
  // direct_llm. Explicit clow values win (derive_clow_needs honors them). Non-fatal.
  const taskBase =
    (ctx.state.task as Record<string, unknown> | undefined) ??
    (ctx.run.metadata.input as Record<string, unknown> | undefined) ??
    {};
  // Thread the run's story scope into the derivation: a story-closure/eval task
  // carries story_id on the RUN, not always in the task body — without this the
  // hermes hint (which needs a story) is never produced and such tasks fall to
  // direct_llm.
  const taskForNeeds = { ...taskBase, story_id: taskBase.story_id ?? ctx.run.story_id ?? undefined };
  try {
    const needs = await rpc<Record<string, unknown>>('derive_clow_needs', {
      p_task: { ...taskForNeeds, ...mergedClow },
    });
    if (needs) {
      mergedClow.needs_write = needs.needs_write;
      mergedClow.needs_internet = needs.needs_internet;
      mergedClow.needs_tools = needs.needs_tools;
      if (!mergedClow.runtime && needs.runtime) mergedClow.runtime = needs.runtime;
    }
  } catch {
    // Derivation unavailable → fn_resolve_runtime still runs with whatever the clow has.
  }

  // ── Runtime derivation: WHICH executor (direct_llm/openclaw/hermes/cli) runs
  // this clow — capability-availability over ai_runtime_registry, NOT a hardcoded
  // 'direct_llm' default. A clow needing write/internet/agent capabilities routes
  // to a runtime that declares them (e.g. openclaw); a runtime that is stated but
  // disabled/unhealthy yields no runtime → FAIL LOUD (never a blind default).
  let runtimeRes: { resolved?: boolean; runtime?: string; reason?: string } | null = null;
  try {
    runtimeRes = await rpc('fn_resolve_runtime', { p_clow: mergedClow });
  } catch (err) {
    return {
      output_data: { error: 'runtime_resolve_failed', detail: String(err).slice(0, 200) },
      transition_key: 'failed',
      fatal_error: 'fn_resolve_runtime RPC failed',
    };
  }
  if (!runtimeRes?.resolved) {
    return {
      output_data: runtimeRes ?? { error: 'no_runtime' },
      transition_key: 'no_runtime',
      fatal_error: `No capable+available runtime for clow purpose="${mergedClow.purpose}": ${runtimeRes?.reason ?? 'none available'}`,
    };
  }
  mergedClow.runtime = runtimeRes.runtime;

  // ── Admission (pre-resolver): may this clow run at all? ────────────────────
  // Capability-availability + risk verdict from fn_admit_clow (spend + runtime-
  // availability + capability-match + risk — NO allow-lists). deny → block the
  // run; ask → pause for human approval; allow → proceed to the backend resolver.
  let admission: { decision?: string; reason_code?: string; awaiting?: string } | null = null;
  try {
    admission = await rpc('fn_admit_clow', {
      p_clow: mergedClow,
      p_context: {
        story_id: ctx.run.story_id,
        estimate_usd: (ctx.run.metadata.context as Record<string, unknown>)?.estimate_usd,
      },
    });
  } catch (err) {
    // FAIL LOUD: do not coerce an admission RPC error into 'allow'. A swallowed
    // gate masks non-functionality (exactly how the %.2f resolver bug stayed hidden
    // — the swallow let a fully-broken resolver look fine). Surface it instead.
    return {
      output_data: { error: 'admission_unavailable', detail: String(err).slice(0, 200) },
      transition_key: 'admission_failed',
      fatal_error: `Admission check failed for clow purpose="${mergedClow.purpose}" — cannot proceed without a verdict`,
    };
  }
  const verdict = admission?.decision ?? 'allow';
  // GAP F: persist the admission outcome to ai_decisions (resolution_source='admission_deny')
  // so a denied/asked task leaves an AUDITABLE decision row, not just a run status — the
  // verdict previously lived only in reflection state. Pre-resolver, so no model_id (the
  // column is nullable). Best-effort: a journal failure must NOT mask the block, which is
  // the authoritative outcome (the node still returns the deny/interrupt below).
  const journalAdmissionOutcome = async (v: 'deny' | 'ask'): Promise<void> => {
    try {
      await rpc('fn_record_execution_decision', {
        p_decision: {
          clow_purpose: (mergedClow as { purpose?: string }).purpose ?? null,
          resolution_source: 'admission_deny',
          admission_verdict: v,
          approval_required: v === 'ask',
          reason: admission?.reason_code ?? v,
        },
        p_run_id: ctx.run.id,
        p_story_id: ctx.run.story_id,
      });
    } catch (err) {
      log.safeWarn(`[openclaw_resolve_clow] admission-${v} journal failed (block still enforced)`, { error: String(err).slice(0, 200) });
    }
  };
  if (verdict === 'deny') {
    await journalAdmissionOutcome('deny');
    return {
      output_data: { admission, error: 'admission_denied' },
      state_patch: { admission_verdict: 'deny', admission_reason: admission?.reason_code ?? 'denied' },
      transition_key: 'admission_denied',
      fatal_error: `Admission denied for clow purpose="${mergedClow.purpose}" (${admission?.reason_code ?? 'denied'})`,
    };
  }
  if (verdict === 'ask') {
    await journalAdmissionOutcome('ask');
    return {
      output_data: { admission },
      state_patch: {
        admission_verdict: 'ask',
        admission_awaiting: admission?.awaiting ?? null,
        pending_approval: { reason: 'admission', awaiting: admission?.awaiting ?? null },
      },
      transition_key: 'admission_ask',
      interrupt: true, // runner pauses the run with status=waiting_human
    };
  }

  let resolution: Record<string, unknown> | null = null;
  try {
    resolution = await rpc<Record<string, unknown>>('aisha_resolve_clow_backend', {
      p_clow: mergedClow,
      p_context: {
        session_id: ctx.run.metadata.context && (ctx.run.metadata.context as Record<string, unknown>).session_id,
        parent_run_id: ctx.run.id,
        budget_remaining:
          (ctx.run.metadata.context as Record<string, unknown>)?.budget_remaining ?? 5.0,
        // The live key/endpoint truth of THIS process — the resolver excludes a
        // provider the DB enabled but we hold no key for (no silent mismatch).
        serviceable_slugs: selectServiceableSlugs(),
      },
    });
  } catch (err) {
    return {
      output_data: { error: 'resolve_rpc_failed', detail: String(err).slice(0, 200) },
      transition_key: 'failed',
      fatal_error: softFail ? undefined : 'aisha_resolve_clow_backend RPC failed',
    };
  }

  const resolved = Boolean(resolution?.resolved);
  if (!resolved && !softFail) {
    return {
      output_data: resolution ?? { error: 'no_resolution' },
      fatal_error: `No backend resolved for clow purpose="${mergedClow.purpose}"`,
    };
  }

  const top = (resolution?.top as ClowBackend | null) ?? null;
  // L0-c: thread the resolver's full candidate ranking + the clow's task_kind onto
  // clow_backend, so the journaled decision (decision_json via toExecutionDecision →
  // fn_record_execution_decision) carries them for the proof harness + L1 rollup.
  const enrichedTop: ClowBackend | null = top
    ? {
        ...top,
        task_kind: (mergedClow as { task_kind?: string }).task_kind,
        candidates: (resolution?.candidates as unknown[]) ?? [],
        // Operator-control lens: the active resolver policy (inputs.policy{id,weights}) the
        // decision was made under — journaled so ai_decisions.resolver_policy_id records WHICH
        // weights were live (fn_record_execution_decision reads decision_json.policy.id).
        policy: (resolution?.inputs as { policy?: unknown } | undefined)?.policy,
      }
    : null;

  return {
    output_data: resolution ?? {},
    state_patch: {
      clow_backend: enrichedTop,
      clow_candidates: resolution?.candidates ?? [],
      preferred_model: top?.model_id,
      preferred_provider: top?.provider_slug,
      preferred_strategy: top?.strategy,
      // The derived executor runtime — runtime_dispatch reads this to route execution.
      derived_runtime: runtimeRes.runtime,
      admission_verdict: 'allow',
    },
    transition_key: resolved ? 'resolved' : 'unresolved',
  };
};
