/**
 * Unit tests for the deliberation ("council"/fusion) efficiency kernel.
 *
 * These lock in the *essence* of the design: deliberation is the gated
 * exception, single-shot is the default, and the planner never overspends.
 * If any of these regress, the council silently becomes a cost/latency tax on
 * ordinary traffic — exactly the failure mode the design exists to prevent.
 */
import { describe, it, expect } from 'vitest';

import {
  planDeliberation,
  type DeliberationInput,
} from '../../reflection/deliberation/planDeliberation.js';
import {
  prepareFusion,
  type FuseCandidate,
} from '../../reflection/deliberation/prepareFusion.js';

// A baseline that, on its own, WOULD escalate (async, high-stakes, affordable).
// Each test overrides only the field under examination.
const escalating: DeliberationInput = {
  interactive: false,
  riskLevel: 'high',
  highStakes: true,
  decomposable: false,
  deadlineHours: 24,
  budgetRemainingUsd: 10,
  maxCostUsd: 10,
  estimatedSingleCostUsd: 0.1,
  maxFanout: 3,
  judgeCostRatio: 1,
};

describe('planDeliberation — efficiency gates (default to single)', () => {
  it('forces single on the interactive hot-path even when high-stakes/high-risk', () => {
    const plan = planDeliberation({ ...escalating, interactive: true });
    expect(plan.topology).toBe('single');
    expect(plan.fanout).toBe(1);
    expect(plan.estimatedCostMultiplier).toBe(1);
    expect(plan.reason).toMatch(/interactive/i);
  });

  it('forces single when policy caps fan-out below 2 (maxFanout=1 disables deliberation)', () => {
    const plan = planDeliberation({ ...escalating, maxFanout: 1 });
    expect(plan.topology).toBe('single');
    expect(plan.reason).toMatch(/maxFanout/i);
  });

  it('forces single when the task is urgent (deadline below the slack threshold)', () => {
    const plan = planDeliberation({ ...escalating, deadlineHours: 0.5 });
    expect(plan.topology).toBe('single');
    expect(plan.reason).toMatch(/urgent/i);
  });

  it('stays single for low-stakes, low/medium-risk work (not a council question)', () => {
    const plan = planDeliberation({
      ...escalating,
      highStakes: false,
      riskLevel: 'low',
    });
    expect(plan.topology).toBe('single');
    expect(plan.reason).toMatch(/single-shot is sufficient/i);
  });
});

describe('planDeliberation — escalation (the gated exception)', () => {
  it('escalates to panel_fuse for a breadth task (non-decomposable, high-stakes, async)', () => {
    const plan = planDeliberation(escalating);
    expect(plan.topology).toBe('panel_fuse');
    expect(plan.fanout).toBeGreaterThanOrEqual(2);
    expect(plan.estimatedCostMultiplier).toBeCloseTo(plan.fanout + 1, 6);
  });

  it('escalates to tree for a decomposable task (multi-step reasoning/planning)', () => {
    const plan = planDeliberation({ ...escalating, decomposable: true });
    expect(plan.topology).toBe('tree');
    expect(plan.fanout).toBeGreaterThanOrEqual(2);
  });

  it('escalates on high risk alone, even without explicit high-stakes flag', () => {
    const plan = planDeliberation({
      ...escalating,
      highStakes: false,
      riskLevel: 'critical',
    });
    expect(plan.topology).not.toBe('single');
  });
});

describe('planDeliberation — affordability (never overspend)', () => {
  it('degrades a council-worthy task to single when even MIN_FANOUT is unaffordable', () => {
    // ceiling = min(budget, maxCost) = 0.25; min plan = 0.1 * (2 + 1) = 0.30 > 0.25
    const plan = planDeliberation({
      ...escalating,
      budgetRemainingUsd: 0.25,
      maxCostUsd: 0.25,
    });
    expect(plan.topology).toBe('single');
    expect(plan.reason).toMatch(/unaffordable/i);
  });

  it('uses the tighter of remaining budget vs per-task ceiling', () => {
    // budget generous, but per-task ceiling 0.25 < min plan 0.30 -> single
    const plan = planDeliberation({
      ...escalating,
      budgetRemainingUsd: 1000,
      maxCostUsd: 0.25,
    });
    expect(plan.topology).toBe('single');
    expect(plan.reason).toMatch(/unaffordable/i);
  });

  it('clamps fan-out down to what the ceiling affords, staying >= MIN_FANOUT', () => {
    // ceiling 0.4 affords k where 0.1*(k+1) <= 0.4 -> k <= 3, but tighten:
    // set ceiling so only k=2 fits: 0.1*(2+1)=0.30 ok, 0.1*(3+1)=0.40 ok too...
    // use 0.35 ceiling -> k=2 (0.30) fits, k=3 (0.40) does not.
    const plan = planDeliberation({
      ...escalating,
      budgetRemainingUsd: 0.35,
      maxCostUsd: 0.35,
    });
    expect(plan.topology).toBe('panel_fuse');
    expect(plan.fanout).toBe(2);
    expect(plan.estimatedCostUsd).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  it('never exceeds the policy fan-out cap', () => {
    const plan = planDeliberation({
      ...escalating,
      maxFanout: 2,
      budgetRemainingUsd: 1000,
      maxCostUsd: 1000,
    });
    expect(plan.fanout).toBeLessThanOrEqual(2);
  });

  it('accounts for a premium judge via judgeCostRatio when checking affordability', () => {
    // judge costs 3x a cheap draft. min plan = 0.1*(2 + 3) = 0.50 > ceiling 0.40
    const plan = planDeliberation({
      ...escalating,
      judgeCostRatio: 3,
      budgetRemainingUsd: 0.4,
      maxCostUsd: 0.4,
    });
    expect(plan.topology).toBe('single');
  });
});

describe('planDeliberation — input validation (reject bad shapes)', () => {
  it('throws on negative cost', () => {
    expect(() => planDeliberation({ ...escalating, estimatedSingleCostUsd: -1 })).toThrow(
      /invalid estimatedSingleCostUsd/i,
    );
  });

  it('throws on non-finite deadline', () => {
    expect(() => planDeliberation({ ...escalating, deadlineHours: Number.NaN })).toThrow(
      /invalid deadlineHours/i,
    );
  });
});

describe('prepareFusion — fusion contract (fuse, do not select)', () => {
  const draft = (source: string, text: string): FuseCandidate => ({ source, text });

  it('throws when there are no candidates', () => {
    expect(() => prepareFusion([])).toThrow(/no candidates/i);
  });

  it('passes through (no fusion) when only one distinct candidate exists', () => {
    const prep = prepareFusion([draft('a', 'answer one')]);
    expect(prep.shouldFuse).toBe(false);
    expect(prep.passthrough?.source).toBe('a');
  });

  it('de-duplicates identical drafts so the judge is not paid to reconcile copies', () => {
    const prep = prepareFusion([
      draft('a', 'The capital is Paris.'),
      draft('b', '  the capital   is paris. '), // same after normalization
      draft('c', 'The capital is Lyon.'),
    ]);
    expect(prep.shouldFuse).toBe(true);
    expect(prep.candidates).toHaveLength(2);
    expect(prep.droppedCount).toBe(1);
  });

  it('drops empty/whitespace-only drafts', () => {
    const prep = prepareFusion([
      draft('a', 'real answer'),
      draft('b', '   '),
      draft('c', 'different answer'),
    ]);
    expect(prep.candidates.map((c) => c.source)).toEqual(['a', 'c']);
    expect(prep.droppedCount).toBe(1);
  });

  it('throws when every candidate is empty', () => {
    expect(() => prepareFusion([draft('a', ''), draft('b', '   ')])).toThrow(/all candidates/i);
  });

  it('caps the panel handed to the judge at maxCandidates', () => {
    const many = Array.from({ length: 8 }, (_, i) => draft(`s${i}`, `answer ${i}`));
    const prep = prepareFusion(many, 3);
    expect(prep.candidates).toHaveLength(3);
    expect(prep.shouldFuse).toBe(true);
  });
});
