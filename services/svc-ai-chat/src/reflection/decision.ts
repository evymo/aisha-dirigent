/**
 * AishaExecutionDecision — the single source of truth for "what AISHA decided
 * to run, on which runtime, with which model".  (E0.1 of the AISHA Orchestration
 * Authority sprint.)
 *
 * THE THREE ORTHOGONAL AXES — do not collapse them:
 *
 *   1. `runtime`      — WHICH ENGINE executes the work.   (NEW discriminant)
 *                       direct_llm | openclaw | hermes | workflow | human | cli
 *   2. `backend_kind` — HOW the model is reached (transport, only meaningful
 *                       when runtime='direct_llm').
 *                       direct_cloud | llm_gateway | local_ollama | local_vllm | mcp_server
 *   3. `LlmProvider`  — WHICH provider serves the tokens (llmRouter axis).
 *
 * `llm_gateway` is a *transport* (backend_kind), NOT a runtime: the executor of
 * a gateway call is still `direct_llm`. The two axes are kept disjoint on
 * purpose — `AISHA_RUNTIMES ∩ BACKEND_KINDS = ∅` — and a gate
 * (execution-decision-sot.gate.test.ts) enforces it.
 *
 * This module also owns the resolver-first dispatch helper used by EVERY
 * reflection LLM node (generator, critic, corrector, occipitum), so AISHA's
 * `aisha_resolve_clow_backend` decision (surfaced as `state.clow_backend`) is
 * honored uniformly instead of each node re-deriving its own model.
 *
 * NOTE: `decision_id` is optional on the shape because the SQL wrapper mints it
 * at write time. Dispatch helpers must still return a durable persisted id and
 * must fail closed if the journal cannot be written.
 *
 * @module
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSafeLogger } from '@aisha/security';
import { resolveProvider, resolveAvailableModel, type LlmProvider } from '../lib/llmRouter.js';
import { providerForResolvedBackend } from '../lib/providerIdentity.js';
import { resolveSlotModel } from './soulforge.js';

const log = createSafeLogger('svc-ai-chat');

// =========================================================================
// Axis value-sets (Zod-first; the const arrays are derived from the schemas
// so there is exactly one place each axis is defined).
// =========================================================================

/** Executor axis — WHICH engine runs the task. */
export const AishaRuntimeSchema = z.enum([
  'direct_llm', // AISHA calls a model directly through a reflection node
  'openclaw', // operative agent-mesh runtime (helpdesk/CRM/onboarding/tools)
  'hermes', // reflexive/expert runtime (closed-story learning, skill creation)
  'workflow', // hand off to an n8n / orchestrated workflow
  'human', // route to a person (approval / manual step)
  'cli', // generic external-CLI driver (claude-cli + future CLIs); specific tool in `agent`/`cli_slug`
  'workbench', // run via the VSCode workbench extension on a local model (poll+block rail, PR-J)
]);
export type AishaRuntime = z.infer<typeof AishaRuntimeSchema>;
export const AISHA_RUNTIMES = AishaRuntimeSchema.options;

/** Transport axis — HOW a model is reached (orthogonal to runtime). */
export const BackendKindSchema = z.enum([
  'direct_cloud',
  'llm_gateway',
  'local_ollama',
  'local_vllm',
  'mcp_server',
]);
export type BackendKind = z.infer<typeof BackendKindSchema>;
export const BACKEND_KINDS = BackendKindSchema.options;

/** Where the model/runtime choice came from (decision provenance). */
export const ResolutionSourceSchema = z.enum([
  'clow_backend', // AISHA's aisha_resolve_clow_backend decision (authoritative)
  'model_override', // explicit graph-node config override
  'slot', // Soulforge slot fallback (no resolver run yet)
  'admission_deny', // admission layer refused the task before resolution
  'policy', // chosen by a governance/admission policy
  'fallback', // last-resort default
]);
export type ResolutionSource = z.infer<typeof ResolutionSourceSchema>;

// =========================================================================
// The SoT: AishaExecutionDecision
// =========================================================================

export const AishaExecutionDecisionSchema = z.object({
  // ── runtime axis (NEW — the crux) ──────────────────────────────────────
  runtime: AishaRuntimeSchema,

  // ── model axis (already returned by aisha_resolve_clow_backend.top) ─────
  provider_slug: z.string().optional(),
  model_id: z.string().optional(),
  backend_kind: BackendKindSchema.optional(), // only meaningful for direct_llm
  strategy: z.enum(['sync', 'batch']).optional(),
  endpoint_url: z.string().optional(),
  auth_env_var: z.string().optional(),
  cost: z.number().optional(),

  // ── governance axis (already computed by aisha_choose_execution_strategy
  //    + governedOrchestration.GovernanceDecision) ─────────────────────────
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  required_capabilities: z.array(z.string()).optional(),
  approval_required: z.boolean().optional(),
  audit_required: z.boolean().optional(),
  admission_verdict: z.enum(['allow', 'ask', 'deny']).optional(),

  // ── provenance ─────────────────────────────────────────────────────────
  resolution_source: ResolutionSourceSchema,
  decision_id: z.string().optional(), // minted by fn_record_execution_decision
  agent: z.string().optional(),
  cli_slug: z.string().optional(), // when runtime='cli': which external CLI (claude-cli, …)
  reason: z.string().optional(),

  // ── L0-c: journal enrichment (optional/backward-compatible). The full-fidelity
  //    decision_json carries these so the proof harness + L1 rollup can read the
  //    task_kind (benchmark join key) and the per-candidate score ranking. ──────
  task_kind: z.string().optional(),
  candidates: z.array(z.unknown()).optional(),
  // Operator-control lens: the active resolver policy (ai_resolver_policy row) the decision was
  // made under — journaled so ai_decisions.resolver_policy_id records which weights were live.
  policy: z.unknown().optional(),
});
export type AishaExecutionDecision = z.infer<typeof AishaExecutionDecisionSchema>;

/**
 * ClowBackend — the model-axis subset AISHA's resolver writes to
 * `state.clow_backend` (the `top` of aisha_resolve_clow_backend). Kept tolerant
 * (`backend_kind: string`) so unmigrated provider rows still resolve — via their
 * `provider_slug` (registry row), no longer via a model-string prefix guess
 * (2026-09-13, see mapBackendKindToProvider). This is the shared
 * type both the WRITER (openclaw_resolve_clow node) and the READERS (every LLM
 * node) import — replacing the former inline `interface ClowBackend`.
 */
export interface ClowBackend {
  provider_slug?: string;
  model_id?: string;
  backend_kind?: string;
  endpoint_url?: string;
  auth_env_var?: string;
  strategy?: string;
  /** Resolved model capacity + pricing (from ai_model_registry via the resolver). Optional:
   *  unmigrated rows / older DBs omit them, so callers fall back to a config default. */
  max_output_tokens?: number;
  context_window?: number;
  input_price_per_m?: number;
  output_price_per_m?: number;
  /** L0-c: the clow's task_kind + the resolver's full per-candidate ranking, threaded onto
   *  clow_backend by openclaw_resolve_clow so the journaled decision (decision_json) carries
   *  them. Read by the orchestration-decision proof harness + the L1 outcome rollup. */
  task_kind?: string;
  candidates?: unknown[];
  /** The active ai_resolver_policy (inputs.policy{id,weights}) — threaded onto the decision so
   *  ai_decisions.resolver_policy_id records which weights produced this choice. */
  policy?: unknown;
}

// =========================================================================
// Resolver-first dispatch — moved out of generator.ts so every node shares it.
// =========================================================================

/**
 * Map a resolved clow's `backend_kind` (+ provider_slug) onto the llmRouter
 * `LlmProvider`.
 *
 * ⛔ NAMĚŘENO 2026-09-13: pro slug mimo anthropic/openai/google (a pro neznámý
 * backend_kind) tu rozhodoval PREFIX model id — `xai` s id bez `grok-` nebo slug,
 * který tenhle proces neobsluhuje, odešel k `openai`. clow_backend je řádek
 * registru, takže o provideru rozhoduje TÝŽ převod jako u každého jiného backendu
 * z resolveru (`providerForResolvedBackend`, providerIdentity.ts) — jedna pravda,
 * ne dvě kopie výčtu druhů a slugů. Řádek, který proces neobsluhuje (nebo backend
 * bez slugu i bez známého druhu), je chyba, ne důvod hádat. Ručně psané id
 * (cfg.model_override) jde přes resolveModelWithClow jinou větví.
 */
export function mapBackendKindToProvider(clow: ClowBackend): LlmProvider {
  const provider = providerForResolvedBackend(clow);
  if (provider) return provider;
  throw new Error(
    `[decision] clow_backend s providerem "${clow.provider_slug ?? ''}" (backend_kind "${clow.backend_kind ?? ''}") ` +
      `tenhle proces neobsluhuje — model "${clow.model_id ?? ''}" se k odhadnutému providerovi neposílá`,
  );
}

export interface ResolveModelArgs {
  /** AISHA's resolver decision from state.clow_backend (authoritative). */
  clowBackend?: ClowBackend;
  /** Graph-node config override (cfg.model_override). */
  modelOverride?: string;
  /** Soulforge slot for fallback resolution. */
  slot: string;
  /** Routing profile ('budget' | 'balanced' | 'maxQuality'). */
  profile: string;
}

export interface ResolvedModel {
  model: string;
  provider: LlmProvider;
  resolution_source: ResolutionSource;
}

/**
 * Resolver-first model selection — AISHA's decision is authoritative.
 * Priority: state.clow_backend → cfg.model_override → slot fallback.
 *
 * Every reflection LLM node MUST obtain its model through this helper; nodes
 * that re-derive a model themselves bypass AISHA's routing authority (the
 * regression E0.2 + the architecture gate prevent).
 */
export async function resolveModelWithClow(args: ResolveModelArgs): Promise<ResolvedModel> {
  const { clowBackend, modelOverride, slot, profile } = args;
  if (clowBackend && clowBackend.model_id) {
    return {
      model: clowBackend.model_id,
      provider: mapBackendKindToProvider(clowBackend),
      resolution_source: 'clow_backend',
    };
  }
  if (modelOverride) {
    return {
      model: modelOverride,
      provider: resolveProvider(modelOverride),
      resolution_source: 'model_override',
    };
  }
  // The slot matrix expresses a PREFERENCE; capability-availability then remaps it
  // to a provider that is actually configured (key present), so AISHA self-functions
  // with whichever provider the operator has — no hardcoded single-provider default.
  const preferred = await resolveSlotModel(slot, profile);
  const { model, provider } = resolveAvailableModel(preferred);
  return { model, provider, resolution_source: 'slot' };
}

// =========================================================================
// E0 admission verdict + decision journal (capability-availability layer).
// =========================================================================

/**
 * The verdict shape returned by the SQL admission composer `fn_admit_clow`
 * (spend + runtime-availability + capability-match + risk → one decision).
 * NOT an allow-list: every axis is derived from a registry row or a threshold
 * policy. See aisha/db/sql/functions/fn_admit_clow.sql.
 */
export interface AdmissionVerdict {
  decision: 'allow' | 'ask' | 'deny';
  axis_results?: Record<string, unknown>;
  reason_code?: string;
  awaiting?: string | null;
}

/** Build a journalable AishaExecutionDecision from a resolved model. */
export function toExecutionDecision(
  resolved: ResolvedModel,
  opts: {
    clowBackend?: ClowBackend;
    runtime?: AishaRuntime;
    agent?: string;
    cliSlug?: string;
    admissionVerdict?: AdmissionVerdict['decision'];
    riskLevel?: AishaExecutionDecision['risk_level'];
    reason?: string;
  } = {},
): AishaExecutionDecision {
  const clow = opts.clowBackend;
  return {
    runtime: opts.runtime ?? 'direct_llm',
    provider_slug: clow?.provider_slug ?? resolved.provider,
    model_id: resolved.model,
    backend_kind: clow?.backend_kind as AishaExecutionDecision['backend_kind'],
    strategy: clow?.strategy as AishaExecutionDecision['strategy'],
    resolution_source: resolved.resolution_source,
    admission_verdict: opts.admissionVerdict,
    risk_level: opts.riskLevel,
    agent: opts.agent,
    cli_slug: opts.cliSlug,
    reason: opts.reason,
    // L0-c: carry the clow's task_kind + the resolver's per-candidate ranking into
    // the journaled decision (fn_record_execution_decision stores the full blob).
    task_kind: clow?.task_kind,
    candidates: clow?.candidates,
    policy: clow?.policy,
  };
}

/**
 * Persist one execution decision to the journal (ai_decisions) via the VOLATILE
 * wrapper fn_record_execution_decision, returning the durable decision_id.
 *
 * Fail-closed by default: the I1 invariant is "no dispatch without a JOURNALED
 * decision", not merely "no dispatch without a UUID-shaped value". If the RPC
 * fails or returns no id, dispatch must stop so audit completeness is preserved.
 *
 * Emergency/local-only escape hatch:
 *   AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED=1
 * returns a client UUID and emits a warning. This keeps cold local experiments
 * possible, while making production audit loss an explicit operator choice.
 */
export async function recordExecutionDecision(
  decision: AishaExecutionDecision,
  runId?: string | null,
  storyId?: string | null,
): Promise<string> {
  let failure: unknown;
  try {
    const { rpc } = await import('./postgrest.js');
    const id = await rpc<string>('fn_record_execution_decision', {
      p_decision: decision,
      p_run_id: runId ?? null,
      p_story_id: storyId ?? null,
    });
    if (typeof id === 'string' && id.length > 0) return id;
    failure = new Error('fn_record_execution_decision returned no decision_id');
  } catch (err) {
    failure = err;
  }

  const errorMessage = failure instanceof Error ? failure.message : String(failure ?? 'unknown journal failure');
  const ctx = {
    runId: runId ?? null,
    storyId: storyId ?? null,
    runtime: decision.runtime,
    model_id: decision.model_id ?? null,
    resolution_source: decision.resolution_source,
  };

  if (process.env.AISHA_DECISION_JOURNAL_ALLOW_UNPERSISTED === '1') {
    const localId = randomUUID();
    log.safeWarn('[decision-journal] unpersisted decision id issued by explicit override', {
      ...ctx,
      decision_id: localId,
      error: errorMessage,
    });
    return localId;
  }

  log.safeError('[decision-journal] failed to persist execution decision; dispatch denied', failure, ctx);
  throw new Error(`decision journal persistence failed; refusing dispatch without durable decision_id: ${errorMessage}`);
}

export interface DispatchDecisionArgs extends ResolveModelArgs {
  runtime?: AishaRuntime;
  agent?: string;
  cliSlug?: string;
  runId?: string | null;
  storyId?: string | null;
  admissionVerdict?: AdmissionVerdict['decision'];
  riskLevel?: AishaExecutionDecision['risk_level'];
}

/**
 * Resolver-first dispatch decision: resolve the model (AISHA-authoritative) AND
 * journal it in one step, returning the resolved model + its decision_id. Every
 * reflection LLM node MUST obtain its model+decision_id through this helper so
 * that (a) no node picks its own model and (b) no dispatch happens without a
 * journaled decision (E0 invariants I1–I3).
 */
export async function dispatchDecision(
  args: DispatchDecisionArgs,
): Promise<ResolvedModel & { decision_id: string }> {
  const resolved = await resolveModelWithClow(args);
  const decision = toExecutionDecision(resolved, {
    clowBackend: args.clowBackend,
    runtime: args.runtime,
    agent: args.agent,
    cliSlug: args.cliSlug,
    admissionVerdict: args.admissionVerdict,
    riskLevel: args.riskLevel,
  });
  const decision_id = await recordExecutionDecision(decision, args.runId, args.storyId);
  return { ...resolved, decision_id };
}
