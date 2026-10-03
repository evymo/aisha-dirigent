/**
 * Deliberation topology planner — the EFFICIENCY GATE of the "council" / fusion
 * extension (E1 enrichment of Tree-of-Thoughts reflection).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A "council" (N cheap drafters in parallel + 1 frontier judge that *fuses* the
 * answers) is a cost/latency REGRESSION on most traffic. It only pays off on a
 * thin slice of high-stakes, async work. The whole design therefore hinges on a
 * cheap, pure, *defaulting-to-single* decision made BEFORE any fan-out happens.
 * That decision is this function. No LLM call, no I/O — just policy over inputs
 * AISHA already has at decision time (risk, stakes, budget, deadline, slot cost).
 *
 * RELATION TO E0 (do NOT duplicate)
 * ---------------------------------
 * The persisted `AishaExecutionDecision` SoT (`reflection/decision.ts`), the
 * `ai_decisions` journal and the admission composer (`fn_admit_clow`,
 * `fn_compute_clow_risk`) live on branch `claude/awesome-northcutt-e09ca7` (E0),
 * NOT on main. When E0 lands, the output of `planDeliberation()` becomes a new
 * `deliberation` axis on that decision (one field + one journal column) — this
 * module is the pure kernel that axis will call, not a re-implementation of it.
 * See docs/proposals/E1_SYNTHESIS_DELIBERATION_TOPOLOGY.md.
 */

export type DeliberationTopology = 'single' | 'panel_fuse' | 'tree';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DeliberationInput {
  /**
   * Latency-sensitive hot-path (interactive chat, `unifiedChat`). When true the
   * planner ALWAYS returns `single` — we never fan out where a human is waiting.
   */
  interactive: boolean;
  /** Computed risk from admission (`fn_compute_clow_risk`). */
  riskLevel: RiskLevel;
  /** "Would you have paid for a premium model for this?" — high value/stakes. */
  highStakes: boolean;
  /**
   * Task decomposes into a search tree (multi-step planning/reasoning) → `tree`;
   * otherwise the breadth case (research / high-stakes writing) → `panel_fuse`.
   */
  decomposable: boolean;
  /** Async slack in hours. Deliberation needs time; urgent work stays single. */
  deadlineHours: number;
  /** Remaining story/tenant budget in USD (`ai_budget`). */
  budgetRemainingUsd: number;
  /** Hard per-task ceiling in USD (`max_cost` on the clow request). */
  maxCostUsd: number;
  /** Estimated cost of ONE draft at the chosen (cheap) drafter slot, in USD. */
  estimatedSingleCostUsd: number;
  /** Policy cap on fan-out width. Set to 1 to disable deliberation entirely. */
  maxFanout: number;
  /**
   * Judge/fuse cost as a multiple of one cheap draft. The judge runs at a
   * premium slot, so this is typically > 1. Defaults to 1 (a conservative floor;
   * real cost is measured by the champion/challenger plane, never trusted blind).
   */
  judgeCostRatio?: number;
}

export interface DeliberationPlan {
  topology: DeliberationTopology;
  /** Number of parallel drafters. Always 1 for `single`. */
  fanout: number;
  /** Total cost as a multiple of one single-shot draft (drafters + judge). */
  estimatedCostMultiplier: number;
  /** Estimated total cost in USD at this plan. */
  estimatedCostUsd: number;
  /** Audit-readable justification — destined for `ai_decisions.reason`. */
  reason: string;
}

/** Below this much async slack we treat the task as urgent → single. */
const MIN_DELIBERATION_HOURS = 1;
/** A council with fewer than two drafters is not a council. */
const MIN_FANOUT = 2;
/** Preferred panel width before affordability/policy clamping. */
const DEFAULT_FANOUT = 3;

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const fmt = (n: number): string => `$${round(n).toFixed(4)}`;

function assertValidInput(input: DeliberationInput): void {
  const numbers: Array<[string, number]> = [
    ['deadlineHours', input.deadlineHours],
    ['budgetRemainingUsd', input.budgetRemainingUsd],
    ['maxCostUsd', input.maxCostUsd],
    ['estimatedSingleCostUsd', input.estimatedSingleCostUsd],
    ['maxFanout', input.maxFanout],
    ['judgeCostRatio', input.judgeCostRatio ?? 1],
  ];
  for (const [name, value] of numbers) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`planDeliberation: invalid ${name}=${String(value)} (must be finite and >= 0)`);
    }
  }
}

/**
 * Decide the deliberation topology for a task. Pure and total: always returns a
 * plan, degrading to `single` whenever deliberation is not warranted OR not
 * affordable. The escalation path is gated — it is the exception, not the norm.
 */
export function planDeliberation(input: DeliberationInput): DeliberationPlan {
  assertValidInput(input);

  const single = (reason: string): DeliberationPlan => ({
    topology: 'single',
    fanout: 1,
    estimatedCostMultiplier: 1,
    estimatedCostUsd: round(input.estimatedSingleCostUsd),
    reason,
  });

  // --- Hard efficiency gates: the cheap path is the default. ----------------
  if (input.interactive) {
    return single('interactive hot-path: latency-sensitive, no fan-out');
  }
  if (input.maxFanout < MIN_FANOUT) {
    return single('policy disables deliberation (maxFanout < 2)');
  }
  if (input.deadlineHours < MIN_DELIBERATION_HOURS) {
    return single('urgent: insufficient async slack for a panel');
  }

  // --- Is this even a "council question"? (value / risk threshold) ----------
  const councilWorthy =
    input.highStakes || input.riskLevel === 'high' || input.riskLevel === 'critical';
  if (!councilWorthy) {
    return single('low stakes and low/medium risk: single-shot is sufficient');
  }

  // --- Affordability: never overspend. Degrade to single if even MIN_FANOUT
  //     would breach the tighter of {remaining budget, per-task ceiling}. -----
  const judgeRatio = input.judgeCostRatio ?? 1;
  const ceiling = Math.min(input.budgetRemainingUsd, input.maxCostUsd);
  const costAt = (k: number): number => input.estimatedSingleCostUsd * (k + judgeRatio);

  if (costAt(MIN_FANOUT) > ceiling) {
    return single(
      `council-worthy but unaffordable: min plan ${fmt(costAt(MIN_FANOUT))} > ceiling ${fmt(ceiling)}`,
    );
  }

  // --- Largest affordable fan-out, capped by policy. ------------------------
  let fanout = Math.max(MIN_FANOUT, Math.min(input.maxFanout, DEFAULT_FANOUT));
  while (fanout > MIN_FANOUT && costAt(fanout) > ceiling) {
    fanout--;
  }

  const topology: DeliberationTopology = input.decomposable ? 'tree' : 'panel_fuse';
  const multiplier = fanout + judgeRatio;
  return {
    topology,
    fanout,
    estimatedCostMultiplier: round(multiplier),
    estimatedCostUsd: round(input.estimatedSingleCostUsd * multiplier),
    reason:
      `${topology}: council-worthy (risk=${input.riskLevel}, highStakes=${String(input.highStakes)}), ` +
      `fanout=${fanout}, ~${round(multiplier)}x single within ceiling ${fmt(ceiling)}`,
  };
}
