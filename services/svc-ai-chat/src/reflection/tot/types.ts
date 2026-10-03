/**
 * Tree-of-Thoughts (ToT v1) — single-run deliberation state contract.
 *
 * The whole tree lives under ONE key, `state.tot`, inside the reflection
 * checkpoint (NodeContext.state is free JSONB) — so ToT v1 needs NO DB migration,
 * only the two node-engine edit points (NodeTypeSchema enum + NODE_HANDLERS).
 *
 * REUSE, DON'T DUPLICATE (PR #443): the topology/fanout decision is made by the
 * deliberation kernel (`deliberation/planDeliberation.ts`) and the fusion
 * pre-flight by `deliberation/prepareFusion.ts`. This module re-uses
 * DeliberationTopology and never re-declares a parallel topology/risk enum.
 * The fusion node (`tot_synthesize`) that consumes prepareFusion is a deliberate
 * sibling for a LATER slot (E1.x-c) and is out of scope for PR-E1.1.
 */
import type { DeliberationTopology } from '../deliberation/planDeliberation.js';

/** Sure/Maybe/Impossible — the ToT evaluation verdict (plus the pre-score state). */
export type ThoughtStatus = 'unevaluated' | 'sure' | 'maybe' | 'impossible';

export interface ThoughtNode {
  id: string;
  parent?: string;
  depth: number;
  content: string;
  status: ThoughtStatus;
  /** critic-style 0..1 promise score (set by tot_evaluate). */
  score?: number;
}

export interface ToTPolicy {
  strategy: 'bfs' | 'dfs' | 'beam';
  /** Drafters per expansion wave — derived from planDeliberation().fanout. */
  wave_width: number;
  /** score >= this → 'sure' (terminal). Default 0.80. */
  sure_threshold: number;
  /** score <= this → 'impossible' (pruned). Default 0.35. */
  impossible_threshold: number;
  /** Hard cap on expansion waves — the free budget backstop. */
  max_expansions: number;
}

export interface ToTState {
  /** id → node. */
  tree: Record<string, ThoughtNode>;
  /** Active thought ids to expand/evaluate next. */
  frontier: string[];
  /** Best terminal thought id so far. */
  best?: string;
  /** Expansion-wave counter (budget). */
  expansions: number;
  policy: ToTPolicy;
  /** The deliberation topology that selected this graph (reused from #443). */
  topology: DeliberationTopology;
}

export const DEFAULT_TOT_POLICY: ToTPolicy = {
  strategy: 'beam',
  wave_width: 3,
  sure_threshold: 0.8,
  impossible_threshold: 0.35,
  max_expansions: 12,
};

/**
 * Map a 0..1 score to Sure/Maybe/Impossible against the policy thresholds.
 * Pure + total — the load-bearing thresholding behaviour gate I9 locks.
 */
export function classifyThought(
  score: number,
  policy: Pick<ToTPolicy, 'sure_threshold' | 'impossible_threshold'>,
): ThoughtStatus {
  if (!Number.isFinite(score)) return 'unevaluated';
  if (score >= policy.sure_threshold) return 'sure';
  if (score <= policy.impossible_threshold) return 'impossible';
  return 'maybe';
}

/** Read state.tot back as a typed ToTState (the checkpoint stores it untyped). */
export function readToT(state: Record<string, unknown>): ToTState | undefined {
  const tot = state.tot;
  return tot && typeof tot === 'object' && 'tree' in tot ? (tot as ToTState) : undefined;
}
