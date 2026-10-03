import type { NodeHandler } from '../types.js';
import { unifiedChat } from '../../lib/llmRouter.js';
import { dispatchDecision, type ClowBackend } from '../decision.js';
import { readToT, type ThoughtNode } from '../tot/types.js';

/**
 * tot_expand — ToT v1 generate-k node.
 *
 * For each non-pruned frontier thought, generates `policy.wave_width` candidate
 * continuations as PARALLEL drafters (Promise.all over unifiedChat). Every
 * drafter dispatch is journaled individually — dispatchDecision lives INSIDE the
 * fan-out — so invariant I1 ("no dispatch without a journaled decision") holds
 * per runtime call, not just per source site. New thoughts append to
 * `state.tot.tree` and become the next frontier for tot_evaluate.
 *
 * Config: slot (default 'semantic'), profile, temperature (diversity), max_tokens,
 *         model_override.
 */
export const totExpand: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const tot = readToT(ctx.state);
  if (!tot) {
    return { output_data: { error: 'no_tot_state' }, fatal_error: 'tot_expand invoked before tot_planner' };
  }

  const slot = (cfg.slot as string) ?? 'semantic';
  const profile = (cfg.profile as string) ?? 'balanced';
  const temperature = (cfg.temperature as number) ?? 0.7; // diversity across drafters
  const maxTokens = (cfg.max_tokens as number) ?? 512;
  const k = Math.max(1, tot.policy.wave_width);
  const clowBackend = ctx.state.clow_backend as ClowBackend | undefined;

  const parents = tot.frontier
    .map((id) => tot.tree[id])
    .filter((n): n is ThoughtNode => !!n && n.status !== 'impossible');

  // Flat (parent, draft#) work list → one parallel fan-out.
  const work: Array<{ parent: ThoughtNode; i: number }> = [];
  for (const parent of parents) for (let i = 0; i < k; i++) work.push({ parent, i });

  const drafts = await Promise.all(
    work.map(async ({ parent, i }) => {
      // I1: journal every drafter dispatch (a decision per runtime call).
      const { model, provider } = await dispatchDecision({
        clowBackend,
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
        systemPrompt:
          'You are one of several independent reasoners exploring a problem. ' +
          'Propose ONE concrete next step or partial solution — specific and self-contained.',
        messages: [
          {
            role: 'user',
            content: `Problem / current thought:\n${parent.content}\n\nDraft #${i + 1}: propose the single next thought.`,
          },
        ],
        temperature,
        maxTokens,
      });
      return { parent, result };
    }),
  );

  let tokensIn = 0;
  let tokensOut = 0;
  let counter = Object.keys(tot.tree).length;
  const newThoughts: ThoughtNode[] = [];
  for (const { parent, result } of drafts) {
    tokensIn += result.usage.inputTokens;
    tokensOut += result.usage.outputTokens;
    const node: ThoughtNode = {
      id: `t${counter++}`,
      parent: parent.id,
      depth: parent.depth + 1,
      content: result.text,
      status: 'unevaluated',
    };
    tot.tree[node.id] = node;
    newThoughts.push(node);
  }

  // New frontier = the freshly generated, still-unevaluated thoughts.
  tot.frontier = newThoughts.map((n) => n.id);
  tot.expansions += 1;

  return {
    output_data: {
      generated: newThoughts.length,
      expansions: tot.expansions,
      frontier_size: tot.frontier.length,
    },
    state_patch: { tot, tot_action: 'evaluate', tot_done: false },
    tokens_input: tokensIn,
    tokens_output: tokensOut,
    transition_key: 'expanded',
  };
};
