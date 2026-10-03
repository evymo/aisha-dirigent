import type { NodeHandler } from '../types.js';
import { unifiedChat } from '../../lib/llmRouter.js';
import { optimizePayload } from '../soulforge.js';
import { submitBatch, type BatchProvider } from '../../lib/batchSubmitter.js';
import { prepareAnthropicBody } from '@aisha/llm-dispatch';
import { dispatchDecision, type ClowBackend } from '../decision.js';

import { createSafeLogger, wrapUntrusted, UNTRUSTED_POLICY_PREAMBLE } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');

/**
 * Generator node — calls llmRouter.unifiedChat with slot-aware model selection
 * and Soulforge payload optimization. No HTTP hop; runs in the same process.
 *
 * Config:
 *   - slot: TaskSlot (default 'ember' or state.slot from prior soulforge_classify)
 *   - temperature: number (default 0.3)
 *   - profile: 'budget' | 'balanced' | 'maxQuality'
 *   - max_tokens: number
 *   - model_override: explicit model id (bypasses slot resolution)
 */
// Backend/runtime resolution lives in the shared SoT: reflection/decision.ts.
// generator now calls resolveModelWithClow() — AISHA's resolver decision
// (state.clow_backend) is authoritative: clow_backend → cfg.model_override →
// slot fallback. See AishaExecutionDecision + mapBackendKindToProvider.

export const generator: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const slot =
    (cfg.slot as string) ??
    (ctx.state.slot as string) ??
    'ember';
  const temperature = (cfg.temperature as number) ?? 0.3;
  const profile =
    (cfg.profile as string) ??
    ((ctx.run.metadata.context as Record<string, unknown>)?.profile as string) ??
    'balanced';
  const maxTokens = (cfg.max_tokens as number) ?? 2048;

  // ── Resolver-first routing (AISHA's decision is authoritative) ────────────
  // The shared helper (reflection/decision.ts) honors state.clow_backend, then
  // cfg.model_override, then slot fallback — identical priority for every node.
  const clowBackend = ctx.state.clow_backend as ClowBackend | undefined;
  const { model, provider, resolution_source: resolutionSource, decision_id } = await dispatchDecision({
    clowBackend,
    modelOverride: cfg.model_override as string | undefined,
    slot,
    profile,
    runtime: 'direct_llm',
    runId: ctx.run.id,
    storyId: ctx.run.story_id,
  });

  const task = (ctx.state.task ?? ctx.run.metadata.input ?? {}) as Record<string, unknown>;
  const description = String(task.description ?? 'no description');
  const priorCriticFeedback = ctx.state.last_critic_feedback as string | undefined;
  const learnings = (ctx.state.learnings ?? []) as Array<{ content: string }>;
  const composedContext = ctx.state.composed_context as Record<string, unknown> | undefined;

  // impl 02 (odysseus): governance/psyche/ruleset are governed internal SoT
  // (trusted). learnings are DERIVED runtime memory — untrusted data, fenced
  // at the prompt boundary (same contract as chat's buildContextPromptSection;
  // impl/15 K2 flagged this second unfenced call site).
  const fenceUntrusted = process.env.UNTRUSTED_WRAPPER_ENABLED !== 'false';
  const systemParts: string[] = [];
  let hasUntrustedContent = false;
  if (composedContext) {
    const layers = (composedContext.layers ?? {}) as Record<string, unknown>;
    if (layers.governance_context) systemParts.push(JSON.stringify(layers.governance_context).slice(0, 800));
    if (layers.psyche_context) systemParts.push(JSON.stringify(layers.psyche_context).slice(0, 600));
    if (layers.ruleset) systemParts.push(JSON.stringify(layers.ruleset).slice(0, 1200));
    if (layers.learnings) {
      const learningsText = `Prior learnings:\n${JSON.stringify(layers.learnings).slice(0, 800)}`;
      if (fenceUntrusted) {
        const fenced = wrapUntrusted('agent_learnings', learningsText);
        if (fenced) {
          systemParts.push(fenced);
          hasUntrustedContent = true;
        }
      } else {
        systemParts.push(learningsText);
      }
    }
  }
  if (hasUntrustedContent) {
    systemParts.unshift(UNTRUSTED_POLICY_PREAMBLE);
  }

  const userParts: string[] = [];
  userParts.push(`Task: ${description}`);
  if (learnings.length > 0) {
    userParts.push(`Recent learnings (${learnings.length}):`);
    learnings.slice(0, 3).forEach((l, i) => userParts.push(` ${i + 1}. ${l.content.slice(0, 280)}`));
  }
  if (priorCriticFeedback) {
    userParts.push(`Critic feedback to address:\n${priorCriticFeedback}`);
  }

  const optimized = optimizePayload(
    { system: systemParts.join('\n\n'), user: userParts.join('\n\n') },
    slot,
    profile,
  );

  // ── Batch dispatch (AISHA's resolver picked deferred execution) ───────────
  // When aisha_resolve_clow_backend returns strategy='batch' AND we resolved
  // to a provider with a native batch endpoint (Anthropic Message Batches or
  // OpenAI Batch API — ~50% off sync pricing), submit the deferred batch
  // instead of a sync call. The run suspends with status=waiting_batch;
  // n8n WF_BATCH_POLLER advances ai_batch_jobs as the batch progresses.
  //
  // SCOPE: only direct anthropic + direct openai today. llm_gateway batch
  // passthrough requires provider-specific JSONL normalization in the
  // gateway daemon, which is a follow-up item (see plan Layer 2D).
  // Soft-fall-through to sync on batch submit failure — the resolver may
  // pick a different backend next iteration, and we prefer a slower sync
  // answer over a hard run failure.
  const wantsBatch =
    clowBackend?.strategy === 'batch' &&
    (provider === 'anthropic' || provider === 'openai');

  if (wantsBatch) {
    const batchProvider = provider as BatchProvider;
    try {
      const batchResult = await submitBatch({
        provider: batchProvider,
        requests: [
          {
            custom_id: ctx.run.id,
            request:
              batchProvider === 'anthropic'
                ? // impl/12 §A (A-3): the batch body comes from the SAME shared
                  // builder as sync/stream — caching/jsonMode/thinking always
                  // reach batch runs too (cached batch read stacks the −50 %
                  // batch discount with the −90 % cache read rate).
                  prepareAnthropicBody({
                    model,
                    maxTokens,
                    temperature,
                    systemPrompt: optimized.system,
                    messages: [{ role: 'user', content: optimized.user }],
                  }).body
                : {
                    model,
                    max_tokens: maxTokens,
                    temperature,
                    messages: [
                      { role: 'system', content: optimized.system },
                      { role: 'user', content: optimized.user },
                    ],
                  },
          },
        ],
        relatedRunId: ctx.run.id,
        agentSlug: 'aisha',
        storyId: ctx.run.story_id ?? undefined,
        metadata: {
          slot,
          profile,
          node_id: ctx.node.id,
          backend_kind: clowBackend?.backend_kind ?? null,
          resolution_source: 'clow_backend',
        },
      });

      return {
        output_data: {
          batch_submitted: true,
          batch_job_id: batchResult.batch_job_id,
          external_batch_id: batchResult.external_batch_id,
          provider: batchProvider,
          model,
          slot,
          profile,
          payload_reduction_pct: optimized.reduction_pct,
          backend_kind: clowBackend?.backend_kind ?? null,
          resolution_source: resolutionSource,
          decision_id,
          note: 'Batch submitted. WF_BATCH_POLLER advances ai_batch_jobs; future WF_BATCH_RESUMER will re-invoke runWorkflow(runId) when results land.',
        },
        state_patch: {
          batch_job_id: batchResult.batch_job_id,
          external_batch_id: batchResult.external_batch_id,
          batch_provider: batchProvider,
          last_model: model,
          last_provider: batchProvider,
          last_backend_kind: clowBackend?.backend_kind ?? null,
          last_resolution_source: resolutionSource,
          last_decision_id: decision_id,
        },
        // Tokens deferred — final usage lands when batch completes via
        // WF_BATCH_POLLER → update_batch_job_status → ai_runs.cost_total.
        tokens_input: 0,
        tokens_output: 0,
        transition_key: 'batch_submitted',
        batch_suspend: true,
      };
    } catch (err) {
      // BatchSubmitError → soft-fall to sync. Logged for observability;
      // the run continues with a normal unifiedChat call below.
      log.safeWarn(
        `[generator] batch submit failed for provider=${batchProvider}; falling back to sync`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  const result = await unifiedChat({
    provider,
    model,
    systemPrompt: optimized.system,
    messages: [{ role: 'user', content: optimized.user }],
    temperature,
    maxTokens,
  });

  return {
    output_data: {
      output: result.text,
      model: result.model,
      provider: result.provider,
      slot,
      profile,
      payload_reduction_pct: optimized.reduction_pct,
      // Drift detection: record what AISHA's resolver picked (if anything)
      // alongside what we actually called. If resolver said llm_gateway and
      // executor called direct anthropic, decision provenance shows the
      // mismatch immediately. See LLM_GATEWAY_DISPATCH_INVARIANTS.md.
      backend_kind: clowBackend?.backend_kind ?? null,
      resolution_source: resolutionSource,
      decision_id,
    },
    state_patch: {
      last_generation: result.text,
      last_model: result.model,
      last_provider: result.provider,
      last_backend_kind: clowBackend?.backend_kind ?? null,
      last_resolution_source: resolutionSource,
      last_decision_id: decision_id,
    },
    tokens_input: result.usage.inputTokens,
    tokens_output: result.usage.outputTokens,
    transition_key: 'generated',
  };
};
