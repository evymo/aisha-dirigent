import type { NodeHandler } from '../types.js';
import { planDeliberation, type RiskLevel } from '../deliberation/planDeliberation.js';
import { DEFAULT_TOT_POLICY, type ToTState, type ThoughtNode } from '../tot/types.js';

/**
 * tot_planner — ToT v1 decomposition / setup node.
 *
 * Establishes the root thought from the task and sizes the search POLICY by
 * REUSING the deliberation kernel (`planDeliberation`, PR #443) — the fanout is
 * planDeliberation().fanout, never re-derived here. No LLM call: turning the
 * problem into candidate thoughts is tot_expand's job; the planner only seeds the
 * tree under the single `state.tot` key (free JSONB checkpoint → no migration)
 * and writes the flat `tot_action` field the guarded edge grammar can route on.
 *
 * Config (all optional):
 *   - strategy: 'bfs'|'dfs'|'beam'                     (default 'beam')
 *   - max_fanout, sure_threshold, impossible_threshold, max_expansions
 *   - risk_level/high_stakes/deadline_hours/budget_remaining/
 *     max_cost/estimated_single_cost_usd           (planDeliberation inputs)
 */
export const totPlanner: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const task = (ctx.state.task ?? ctx.run.metadata.input ?? {}) as Record<string, unknown>;
  const description = String(task.description ?? 'no task description');

  const maxFanout = (cfg.max_fanout as number) ?? DEFAULT_TOT_POLICY.wave_width;
  // Reuse the deliberation kernel to size the wave — risk/budget/deadline policy
  // is owned there, not re-implemented in the node. We are in the tree graph, so
  // decomposable=true and interactive=false (the async/escalated path).
  const plan = planDeliberation({
    interactive: false,
    riskLevel: (cfg.risk_level as RiskLevel) ?? (ctx.state.risk_level as RiskLevel) ?? 'high',
    highStakes: (cfg.high_stakes as boolean) ?? true,
    decomposable: true,
    deadlineHours: (cfg.deadline_hours as number) ?? 24,
    budgetRemainingUsd: (cfg.budget_remaining as number) ?? (ctx.state.budget_remaining as number) ?? 1,
    maxCostUsd: (cfg.max_cost as number) ?? 1,
    estimatedSingleCostUsd: (cfg.estimated_single_cost_usd as number) ?? 0.01,
    maxFanout,
  });

  const waveWidth = Math.max(1, plan.fanout);
  const policy: ToTState['policy'] = {
    strategy: (cfg.strategy as ToTState['policy']['strategy']) ?? DEFAULT_TOT_POLICY.strategy,
    wave_width: waveWidth,
    sure_threshold: (cfg.sure_threshold as number) ?? DEFAULT_TOT_POLICY.sure_threshold,
    impossible_threshold: (cfg.impossible_threshold as number) ?? DEFAULT_TOT_POLICY.impossible_threshold,
    max_expansions: (cfg.max_expansions as number) ?? DEFAULT_TOT_POLICY.max_expansions,
  };

  const root: ThoughtNode = { id: 'root', depth: 0, content: description, status: 'unevaluated' };
  const tot: ToTState = {
    tree: { root },
    frontier: ['root'],
    expansions: 0,
    policy,
    topology: plan.topology,
  };

  return {
    output_data: {
      topology: plan.topology,
      fanout: waveWidth,
      deliberation_reason: plan.reason,
      root_thought: description.slice(0, 200),
    },
    state_patch: {
      tot,
      tot_topology: plan.topology,
      tot_action: 'expand',
      tot_done: false,
    },
    transition_key: 'planned',
  };
};
