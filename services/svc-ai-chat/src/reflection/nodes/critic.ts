import type { NodeHandler } from '../types.js';
import { unifiedChat } from '../../lib/llmRouter.js';
import { dispatchDecision, type ClowBackend } from '../decision.js';

/**
 * Critic node — evaluates last_generation against configured rules.
 * Calls llmRouter directly with JSON mode. Returns scores per rule + textual feedback.
 *
 * Config:
 *   - rules: string[]
 *   - slot: TaskSlot (default 'verify')
 *   - profile: 'budget' | 'balanced' | 'maxQuality'
 *   - max_tokens: number
 *   - model_override: explicit model id
 */
export const critic: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const rules = (cfg.rules as string[]) ?? ['compliance', 'risk', 'completeness'];
  const slot = (cfg.slot as string) ?? 'verify';
  const profile = (cfg.profile as string) ?? 'balanced';
  const maxTokens = (cfg.max_tokens as number) ?? 1024;
  const lastGeneration = ctx.state.last_generation as string | undefined;

  if (!lastGeneration) {
    return {
      output_data: { error: 'no_prior_generation' },
      fatal_error: 'critic invoked with no prior generation in state',
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
    'You are an evaluation agent.',
    'Score the user output for each rule on 0.0..1.0 with a one-sentence rationale.',
    'Return STRICT JSON only: { "scores": { "<rule_slug>": <number>, ... }, "feedback": "..." }',
  ].join('\n');

  const userPrompt = [
    `Rules to evaluate: ${rules.join(', ')}`,
    '',
    'Output to evaluate:',
    lastGeneration,
  ].join('\n');

  const result = await unifiedChat({
    provider,
    model,
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.1,
    maxTokens,
    jsonMode: true,
  });

  let parsed: { scores: Record<string, number>; feedback: string };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    parsed = { scores: {}, feedback: result.text };
  }

  const numericScores = Object.values(parsed.scores).filter((v) => typeof v === 'number');
  const overall =
    numericScores.length > 0
      ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
      : 0.5;

  return {
    output_data: {
      scores: parsed.scores,
      overall,
      feedback: parsed.feedback,
      model: result.model,
      decision_id,
    },
    state_patch: {
      last_critic_scores: parsed.scores,
      last_critic_overall: overall,
      last_critic_feedback: parsed.feedback,
    },
    tokens_input: result.usage.inputTokens,
    tokens_output: result.usage.outputTokens,
    transition_key: overall >= 0.5 ? 'critic_pass' : 'critic_fail',
  };
};
