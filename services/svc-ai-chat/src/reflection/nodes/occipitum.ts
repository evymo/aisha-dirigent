import type { NodeHandler } from '../types.js';
import { unifiedChat } from '../../lib/llmRouter.js';
import { dispatchDecision, type ClowBackend } from '../decision.js';

/**
 * occipitum_creative — creative-mode generation branch.
 * Pulls richer Psyché context and uses higher temperature.
 */
export const occipitumCreative: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const slot = (cfg.slot as string) ?? 'semantic';
  const profile = (cfg.profile as string) ?? 'maxQuality';
  const temperature = (cfg.temperature as number) ?? 0.85;
  const maxTokens = (cfg.max_tokens as number) ?? 3000;

  const task = (ctx.run.metadata.input ?? {}) as Record<string, unknown>;
  const description = String(task.description ?? '');
  const composedContext = ctx.state.composed_context as Record<string, unknown> | undefined;

  const systemParts: string[] = [
    'You are in CREATIVE mode. Optimize for novelty, brand voice, emotional resonance.',
    'Stay grounded in the partner DNA from the context bundle.',
  ];
  if (composedContext) {
    const layers = (composedContext.layers ?? {}) as Record<string, unknown>;
    if (layers.psyche_context) systemParts.push(JSON.stringify(layers.psyche_context).slice(0, 1500));
  }

  const { model, provider, decision_id } = await dispatchDecision({
    clowBackend: ctx.state.clow_backend as ClowBackend | undefined,
    modelOverride: cfg.model_override as string | undefined,
    slot,
    profile,
    runtime: 'direct_llm',
    runId: ctx.run.id,
    storyId: ctx.run.story_id,
  });

  const result = await unifiedChat({
    provider,
    model,
    systemPrompt: systemParts.join('\n\n'),
    messages: [{ role: 'user', content: `Task: ${description}` }],
    temperature,
    maxTokens,
  });

  return {
    output_data: { creative_branch: result.text, model: result.model, decision_id },
    state_patch: { creative_alternative: result.text },
    tokens_input: result.usage.inputTokens,
    tokens_output: result.usage.outputTokens,
    transition_key: 'generated',
  };
};
