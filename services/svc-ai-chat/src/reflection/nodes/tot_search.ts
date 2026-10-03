import type { NodeHandler } from '../types.js';
import { readToT, type ThoughtNode } from '../tot/types.js';

/**
 * tot_search — ToT v1 search controller.
 *
 * Pure decision node: NO LLM, NO dispatch. Holds ALL the BFS/DFS/beam policy +
 * backtrack + budget logic, and emits ONLY the flat routing fields the guarded
 * edge grammar can read — `tot_action` ('expand'|'done') and `tot_done` (bool).
 * Nothing nested goes into edge conditions: evalGuardedExpression supports only
 * identifiers / dot-paths / comparisons / AND-OR, no functions or objects, so the
 * decision is reduced to flat state here and the graph edges merely branch on it.
 *
 * Terminates when a 'sure' thought is found, the expansion budget is spent, or no
 * 'maybe' candidates survive; otherwise beam-selects the next frontier.
 */
export const totSearch: NodeHandler = async (ctx) => {
  const tot = readToT(ctx.state);
  if (!tot) {
    return { output_data: { error: 'no_tot_state' }, fatal_error: 'tot_search invoked before tot_planner' };
  }

  const all = Object.values(tot.tree) as ThoughtNode[];
  const scored = all.filter((t) => typeof t.score === 'number');
  const best = scored.reduce<ThoughtNode | undefined>(
    (b, t) => (!b || (t.score ?? 0) > (b.score ?? 0) ? t : b),
    undefined,
  );
  tot.best = best?.id;

  const foundSure = scored.some((t) => t.status === 'sure');
  const exhausted = tot.expansions >= tot.policy.max_expansions;

  // Next frontier = surviving 'maybe' thoughts, beam-capped, best-first.
  const candidates = all
    .filter((t) => t.status === 'maybe')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, tot.policy.wave_width);

  const done = foundSure || exhausted || candidates.length === 0;
  if (done) {
    tot.frontier = [];
    return {
      output_data: {
        done: true,
        reason: foundSure ? 'sure' : exhausted ? 'exhausted' : 'no_candidates',
        best: tot.best,
        best_score: best?.score ?? null,
      },
      state_patch: {
        tot,
        tot_action: 'done',
        tot_done: true,
        tot_best: best?.content ?? null,
      },
      transition_key: 'done',
    };
  }

  tot.frontier = candidates.map((t) => t.id);
  return {
    output_data: { done: false, frontier: tot.frontier, expansions: tot.expansions, best: tot.best },
    state_patch: { tot, tot_action: 'expand', tot_done: false },
    transition_key: 'expand',
  };
};
