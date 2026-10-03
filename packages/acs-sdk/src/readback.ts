/**
 * Readback state machine for side effects (R5 / IP-8).
 *
 *   propose → confirm → execute      (happy path)
 *   propose → abort                  (constraint violation / deny)
 *
 * The decision is MACHINE comparison: the proposal's params hash must match
 * the exact parameters at execution time, the effect class must be whitelisted,
 * and intent constraints (allowed tools, budget) are checked structurally.
 * Prose plays no role. Unclassified effects are deny-fast: a new tool must be
 * classified before it may act.
 */
import { createHash } from 'node:crypto';
import type { EffectClass, EffectProposePayload, EffectDecisionPayload } from '@aisha/acs-contracts';
import { canonicalJson } from './canonicalJson.js';
import { effectId } from './ulid.js';

export interface IntentConstraints {
  allowed_tools?: string[];
  budget_units?: number;
}

export interface EffectPolicy {
  /** Effect classes that may execute at all (whitelist). */
  executableClasses: readonly EffectClass[];
  /** Optional per-class budget ceilings in abstract units. */
  classBudgets?: Partial<Record<EffectClass, number>>;
}

export const DEFAULT_EFFECT_POLICY: EffectPolicy = {
  executableClasses: ['write', 'delete', 'payment', 'deploy', 'external_call'],
};

export function hashParams(params: unknown): string {
  return createHash('sha256').update(canonicalJson(params ?? {})).digest('hex');
}

export function buildProposal(input: {
  toolName: string;
  effectClass: EffectClass;
  intentRef: string;
  target: string;
  action: string;
  params: unknown;
  summary?: string;
}): EffectProposePayload {
  return {
    effect_id: effectId(),
    tool_name: input.toolName,
    effect_class: input.effectClass,
    intent_ref: input.intentRef,
    proposal: {
      target: input.target,
      action: input.action,
      params_sha256: hashParams(input.params),
      ...(input.summary ? { summary: input.summary.slice(0, 1000) } : {}),
    },
  };
}

/** Machine decision over a proposal. Pure function — trivially testable. */
export function decideProposal(
  proposal: EffectProposePayload,
  constraints: IntentConstraints | null,
  policy: EffectPolicy = DEFAULT_EFFECT_POLICY,
  spentBudgetUnits = 0,
): EffectDecisionPayload {
  const base = {
    effect_id: proposal.effect_id,
    params_sha256: proposal.proposal.params_sha256,
  };

  if (proposal.effect_class === 'unclassified' || !policy.executableClasses.includes(proposal.effect_class)) {
    return { ...base, decision: 'abort', decided_by: 'constraint_check', reason_code: 'effect_class_not_executable' };
  }

  if (constraints?.allowed_tools && !constraints.allowed_tools.includes(proposal.tool_name)) {
    return { ...base, decision: 'abort', decided_by: 'acl', reason_code: 'tool_not_in_intent_allowlist' };
  }

  const ceiling = policy.classBudgets?.[proposal.effect_class];
  const intentBudget = constraints?.budget_units;
  const effectiveBudget = [ceiling, intentBudget].filter((v): v is number => typeof v === 'number');
  if (effectiveBudget.length > 0 && spentBudgetUnits >= Math.min(...effectiveBudget)) {
    return { ...base, decision: 'abort', decided_by: 'budget_gate', reason_code: 'budget_exhausted' };
  }

  return { ...base, decision: 'confirm', decided_by: 'constraint_check', reason_code: null };
}

/**
 * Execution guard: runs `execute` only when a confirm decision exists AND the
 * parameters at execution time hash to exactly what was proposed. Any drift
 * between proposal and execution is a hard failure (R5).
 */
export async function executeGuarded<T>(
  proposal: EffectProposePayload,
  decision: EffectDecisionPayload,
  params: unknown,
  execute: () => Promise<T>,
): Promise<T> {
  if (decision.effect_id !== proposal.effect_id) {
    throw new Error('ACS readback: decision belongs to a different effect');
  }
  if (decision.decision !== 'confirm') {
    throw new Error(`ACS readback: effect aborted (${decision.reason_code ?? 'no_reason'})`);
  }
  const actual = hashParams(params);
  if (actual !== proposal.proposal.params_sha256 || actual !== decision.params_sha256) {
    throw new Error('ACS readback: parameters drifted between proposal and execution');
  }
  return execute();
}
