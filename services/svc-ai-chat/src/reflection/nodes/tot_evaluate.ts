import type { NodeHandler } from '../types.js';
import { unifiedChat } from '../../lib/llmRouter.js';
import { dispatchDecision, type ClowBackend } from '../decision.js';
import { readToT, classifyThought, type ThoughtNode } from '../tot/types.js';

/**
 * tot_evaluate — ToT v1 evaluate node.
 *
 * A thin layer over the SAME 0..1 JSON scoring the `critic` node uses, applied to
 * the whole frontier in ONE journaled dispatch, then mapped to
 * Sure/Maybe/Impossible via the policy thresholds (`classifyThought`). Writes
 * score + status back onto each frontier thought; the search policy itself lives
 * in tot_search — evaluate only judges. Emits the flat `tot_action` routing field.
 *
 * Config: slot (default 'verify'), profile, max_tokens, model_override.
 */
export const totEvaluate: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const tot = readToT(ctx.state);
  if (!tot) {
    return { output_data: { error: 'no_tot_state' }, fatal_error: 'tot_evaluate invoked before tot_planner' };
  }

  const frontier = tot.frontier
    .map((id) => tot.tree[id])
    .filter((n): n is ThoughtNode => !!n);
  if (frontier.length === 0) {
    return {
      output_data: { evaluated: 0, note: 'empty frontier' },
      state_patch: { tot, tot_action: 'search', tot_done: false },
      transition_key: 'evaluated',
    };
  }

  const slot = (cfg.slot as string) ?? 'verify';
  const profile = (cfg.profile as string) ?? 'balanced';
  const maxTokens = (cfg.max_tokens as number) ?? 1024;
  const clowBackend = ctx.state.clow_backend as ClowBackend | undefined;

  const { model, provider, decision_id } = await dispatchDecision({
    clowBackend,
    modelOverride: cfg.model_override as string | undefined,
    slot,
    profile,
    runtime: 'direct_llm',
    runId: ctx.run.id,
    storyId: ctx.run.story_id,
  });

  const goal = tot.tree.root?.content ?? '';
  const systemPrompt = [
    'You are an evaluation agent scoring candidate next-steps in a reasoning search.',
    'Score each candidate 0.0..1.0 for how promising it is toward solving the goal.',
    // The literal lowercase word "json" must appear in the prompt: OpenAI's
    // Responses API rejects json_object output otherwise (a real cross-provider
    // requirement the stub hid). Keep it explicit so every backend is satisfied.
    'Return ONLY a json object of the form { "scores": { "<id>": <number>, ... } } — no prose, no markdown.',
  ].join('\n');
  const userPrompt = [
    `Goal:\n${goal}`,
    '',
    'Candidates:',
    ...frontier.map((t) => `- ${t.id}: ${t.content}`),
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

  let scores: Record<string, number> = {};
  try {
    scores = (JSON.parse(result.text) as { scores?: Record<string, number> }).scores ?? {};
  } catch {
    scores = {};
  }

  let sure = 0;
  let maybe = 0;
  let impossible = 0;
  for (const t of frontier) {
    const raw = scores[t.id];
    const score = typeof raw === 'number' ? raw : 0.5; // unscored → neutral 'maybe'
    t.score = score;
    t.status = classifyThought(score, tot.policy);
    if (t.status === 'sure') sure++;
    else if (t.status === 'impossible') impossible++;
    else maybe++;
  }

  return {
    output_data: { evaluated: frontier.length, sure, maybe, impossible, decision_id },
    state_patch: { tot, tot_action: 'search', tot_done: false },
    tokens_input: result.usage.inputTokens,
    tokens_output: result.usage.outputTokens,
    transition_key: 'evaluated',
  };
};
