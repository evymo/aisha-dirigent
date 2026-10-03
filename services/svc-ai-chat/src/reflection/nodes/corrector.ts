import type { NodeHandler } from '../types.js';
import { unifiedChat } from '../../lib/llmRouter.js';
import { dispatchDecision, type ClowBackend } from '../decision.js';

/**
 * Corrector node — given critic feedback, produce a corrected version of
 * last_generation. Sets state.last_generation so downstream critic re-evaluates.
 */
export const corrector: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const slot = (cfg.slot as string) ?? 'ember';
  const profile = (cfg.profile as string) ?? 'balanced';
  const maxTokens = (cfg.max_tokens as number) ?? 2048;

  const prior = ctx.state.last_generation as string | undefined;
  const feedback = ctx.state.last_critic_feedback as string | undefined;

  if (!prior || !feedback) {
    return {
      output_data: { error: 'missing_prior_or_feedback' },
      fatal_error: 'corrector invoked without prior generation + critic feedback',
    };
  }

  const { model, provider, decision_id } = await dispatchDecision({
    clowBackend: ctx.state.clow_backend as ClowBackend | undefined,
    modelOverride: cfg.model_override as string | undefined,
    slot,
    profile,
    runId: ctx.run.id,
    storyId: ctx.run.story_id,
  });

  const systemPrompt = [
    'You are correcting a prior output based on critic feedback.',
    'Preserve correct parts; fix only what the feedback identifies.',
    'Return the corrected output only — no preamble.',
  ].join('\n');

  const userPrompt = [
    'Prior output:',
    prior,
    '',
    'Critic feedback:',
    feedback,
  ].join('\n');

  const result = await unifiedChat({
    provider,
    model,
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.2,
    maxTokens,
  });

  return {
    output_data: { corrected: result.text, model: result.model, decision_id },
    state_patch: {
      last_generation: result.text,
      last_critic_feedback: undefined,
    },
    tokens_input: result.usage.inputTokens,
    tokens_output: result.usage.outputTokens,
    transition_key: 'corrected',
  };
};
