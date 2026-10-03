/**
 * Governed Orchestration — Phase B
 *
 * Unifies four orchestration subsystems into a single decision matrix:
 * 1. Route plan (from route_task RPC)
 * 2. Escalation signals (from pattern detection)
 * 3. Compliance requirements (from route plan + risk analysis)
 * 4. Delivery state awareness (from story context)
 *
 * Produces a single `GovernanceDecision` that replaces ad-hoc RoutePlanHint
 * construction in the chat pipeline. All governance decisions are recorded
 * into the decision provenance chain (Phase A).
 *
 * @module
 */

import type { DecisionChain, DecisionSourceType } from "./decisionProvenance.ts";

// =============================================================================
// Types
// =============================================================================

/** Route plan from routeViaAisha() — nullable when degraded. */
export interface RouteSignal {
  runId: string;
  agents: Array<{ slug: string; model: string; context_profile: string; step_index: number }>;
  toolsAllowlist: string[];
  stopConditions: {
    max_loops: number;
    must_pass_compliance: boolean;
    require_human_approval: boolean;
  };
}

/** Escalation signals detected in user message. */
export type EscalationSignal = "frustration" | "compliance" | "incident" | "highValue";

/** Delivery state extracted from story context. */
export interface DeliveryStateSignal {
  storyId: string;
  currentStatus: string | null;
  /** Allowed next transitions (from get_allowed_transitions). */
  allowedTransitions?: Array<{ to_status: string; requires_role: string | null }>;
}

/**
 * Risk level resolved from combined signals.
 * Determines approval boundaries and model escalation.
 */
export type GovernanceRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Approval boundary — defines when human approval is required.
 */
export interface ApprovalBoundary {
  /** Whether human approval is required before action execution. */
  required: boolean;
  /** Reason for requiring (or not requiring) approval. */
  reason: string;
  /** Source of the approval requirement decision. */
  source: DecisionSourceType;
}

/**
 * Stop condition — defines when execution should halt or degrade.
 */
export interface StopCondition {
  /** Unique identifier for the stop condition. */
  id: string;
  /** Whether this stop condition is currently triggered. */
  triggered: boolean;
  /** Human-readable reason. */
  reason: string;
  /** What action to take: halt (stop entirely), degrade (continue with restrictions), warn (log but continue). */
  action: "halt" | "degrade" | "warn";
}

/**
 * Unified governance decision — replaces ad-hoc RoutePlanHint construction.
 */
export interface GovernanceDecision {
  /** Resolved risk level from combined signals. */
  riskLevel: GovernanceRiskLevel;
  /** Effective model to use (may be escalated from route plan). */
  effectiveModel: string | null;
  /** Source of model decision. */
  modelSource: string;
  /** Whether compliance directive should be injected. */
  requireCompliance: boolean;
  /** Approval boundary decision. */
  approval: ApprovalBoundary;
  /** Resolved stop conditions. */
  stopConditions: StopCondition[];
  /** Tools allowlist (from route plan, may be restricted by risk level). */
  toolsAllowlist: string[] | null;
  /** Maximum tool iterations (may be reduced by risk level). */
  maxToolIterations: number;
  /** Whether to force model across all workflow nodes. */
  forceModelAcrossWorkflow: boolean;
  /** Forced category bypass (from route plan). */
  forcedCategory: string | null;
  /** Task kind for metadata. */
  taskKind: string;
  /** Run ID from route plan (for tracing). */
  runId: string | null;
  /** Delivery state context. */
  deliveryState: DeliveryStateSignal | null;
  /** All triggered escalation signals. */
  escalationSignals: EscalationSignal[];
  /** Tao governance constraints derived from core_value principles. */
  taoConstraints: TaoGovernanceConstraints | null;
}

// =============================================================================
// Tao Governance Layer
// =============================================================================

/** A single tao principle from the governance context. */
export interface TaoPrinciple {
  slug: string;
  title: string;
  summary: string;
  ai_instructions: string;
  tags: string[];
}

/** Tao-derived governance constraints. */
export interface TaoGovernanceConstraints {
  /** No decision may be punitive — escalations are protective. */
  noPunitiveActions: boolean;
  /** No degradation is permanent — always a path back. */
  noPermanentDegradation: boolean;
  /** Warmth floor — all system responses must maintain warmth. */
  warmthFloor: boolean;
  /** Confidence gate — autonomous actions require high confidence. */
  confidenceGate: boolean;
  /** Personalization required — per-user adaptation is mandatory. */
  personalizationRequired: boolean;
  /** Adversarial handling — reject with warmth, never negativity. */
  warmAdversarialResponse: boolean;
  /** Source tao principle slugs that informed these constraints. */
  sourceSlugs: string[];
}

/**
 * Derive governance constraints from tao principles.
 *
 * Reads ai_instructions from core_value items and maps them to
 * structured constraints that the governance matrix can enforce.
 * Tao principles use a `governance:` prefix convention in ai_instructions
 * to indicate their governance applicability.
 */
export function deriveTaoConstraints(
  taoPrinciples: TaoPrinciple[] | null | undefined,
): TaoGovernanceConstraints | null {
  if (!taoPrinciples || taoPrinciples.length === 0) {
    return null;
  }

  const slugs = taoPrinciples.map((p) => p.slug);
  const instructions = taoPrinciples
    .map((p) => p.ai_instructions ?? "")
    .join("\n");

  return {
    noPunitiveActions: instructions.includes("governance:decision_filter"),
    noPermanentDegradation: instructions.includes("governance:escalation_policy"),
    warmthFloor: instructions.includes("governance:tone_invariant"),
    confidenceGate: instructions.includes("governance:confidence_gate"),
    personalizationRequired: instructions.includes("governance:personalization"),
    warmAdversarialResponse: instructions.includes("governance:adversarial_response"),
    sourceSlugs: slugs,
  };
}

// =============================================================================
// Risk Resolution Matrix
// =============================================================================

/**
 * Risk resolution rules — combining multiple signals into a single risk level.
 * Each rule is evaluated in order; first match wins.
 *
 * These rules encode the governance policy:
 * - Compliance + incident signals → critical
 * - Route plan high risk or incident alone → high
 * - Escalation signals (frustration, highValue) → medium
 * - Default → from route plan or low
 */
interface RiskRule {
  id: string;
  condition: (ctx: RiskResolutionContext) => boolean;
  riskLevel: GovernanceRiskLevel;
  reason: string;
}

interface RiskResolutionContext {
  routePlan: RouteSignal | null;
  escalationSignals: EscalationSignal[];
  deliveryState: DeliveryStateSignal | null;
  routePlanRiskProfile: string;
}

const RISK_RULES: RiskRule[] = [
  {
    id: "compliance_plus_incident",
    condition: (ctx) =>
      ctx.escalationSignals.includes("compliance") &&
      ctx.escalationSignals.includes("incident"),
    riskLevel: "critical",
    reason: "Compliance + incident signals detected simultaneously",
  },
  {
    id: "route_plan_high_risk",
    condition: (ctx) => ctx.routePlanRiskProfile === "high",
    riskLevel: "high",
    reason: "Route plan flagged high risk",
  },
  {
    id: "incident_signal",
    condition: (ctx) => ctx.escalationSignals.includes("incident"),
    riskLevel: "high",
    reason: "Incident signal detected",
  },
  {
    id: "compliance_signal",
    condition: (ctx) => ctx.escalationSignals.includes("compliance"),
    riskLevel: "high",
    reason: "Compliance-related content detected",
  },
  {
    id: "delivery_blocked",
    condition: (ctx) => ctx.deliveryState?.currentStatus === "blocked",
    riskLevel: "medium",
    reason: "Story delivery is currently blocked",
  },
  {
    id: "frustration_or_high_value",
    condition: (ctx) =>
      ctx.escalationSignals.includes("frustration") ||
      ctx.escalationSignals.includes("highValue"),
    riskLevel: "medium",
    reason: "Frustration or high-value signal detected",
  },
  {
    id: "route_plan_medium",
    condition: (ctx) => ctx.routePlanRiskProfile === "medium",
    riskLevel: "medium",
    reason: "Route plan flagged medium risk",
  },
];

/**
 * Resolve risk level from combined signals.
 * Evaluates risk rules in order; first match determines the risk level.
 * Falls back to route plan risk or "low".
 */
export function resolveRiskLevel(ctx: RiskResolutionContext): { riskLevel: GovernanceRiskLevel; reason: string; ruleId: string } {
  for (const rule of RISK_RULES) {
    if (rule.condition(ctx)) {
      return { riskLevel: rule.riskLevel, reason: rule.reason, ruleId: rule.id };
    }
  }
  return { riskLevel: "low", reason: "No risk signals detected", ruleId: "default" };
}

// =============================================================================
// Approval Boundaries
// =============================================================================

/** Delivery statuses that require admin/staff approval for transition. */
const APPROVAL_REQUIRED_STATUSES = new Set([
  "delivering",
  "delivered",
  "archived",
]);

/** Delivery statuses where chat actions should be restricted. */
const RESTRICTED_ACTION_STATUSES = new Set([
  "qa",
  "delivering",
  "delivered",
]);

/**
 * Resolve whether human approval is required based on governance signals.
 */
export function resolveApprovalBoundary(
  riskLevel: GovernanceRiskLevel,
  routePlan: RouteSignal | null,
  deliveryState: DeliveryStateSignal | null,
): ApprovalBoundary {
  // 1. Route plan explicitly requires approval
  if (routePlan?.stopConditions.require_human_approval) {
    return {
      required: true,
      reason: "Route plan mandates human approval",
      source: "orchestration_policy",
    };
  }

  // 2. Critical risk level always requires approval
  if (riskLevel === "critical") {
    return {
      required: true,
      reason: "Critical risk level requires human approval",
      source: "compliance_policy",
    };
  }

  // 3. Delivery state-based approval
  if (deliveryState?.currentStatus && APPROVAL_REQUIRED_STATUSES.has(deliveryState.currentStatus)) {
    return {
      required: true,
      reason: `Delivery status '${deliveryState.currentStatus}' requires approval for actions`,
      source: "orchestration_policy",
    };
  }

  return {
    required: false,
    reason: "No approval required for current context",
    source: "orchestration_policy",
  };
}

// =============================================================================
// Stop Conditions
// =============================================================================

/**
 * Evaluate all applicable stop conditions for the current context.
 */
export function evaluateStopConditions(
  riskLevel: GovernanceRiskLevel,
  routePlan: RouteSignal | null,
  deliveryState: DeliveryStateSignal | null,
  escalationSignals: EscalationSignal[],
): StopCondition[] {
  const conditions: StopCondition[] = [];

  // 1. Max loop limit from route plan
  const maxLoops = routePlan?.stopConditions.max_loops ?? 3;
  conditions.push({
    id: "max_loops",
    triggered: false, // evaluated at runtime by workflow engine
    reason: `Maximum ${maxLoops} tool iterations allowed`,
    action: "halt",
  });

  // 2. Compliance gate
  if (routePlan?.stopConditions.must_pass_compliance || riskLevel === "critical" || riskLevel === "high") {
    conditions.push({
      id: "compliance_gate",
      triggered: true,
      reason: riskLevel === "critical" || riskLevel === "high"
        ? `Risk level '${riskLevel}' mandates compliance check`
        : "Route plan requires compliance pass",
      action: "degrade",
    });
  }

  // 3. Restricted delivery state
  if (deliveryState?.currentStatus && RESTRICTED_ACTION_STATUSES.has(deliveryState.currentStatus)) {
    conditions.push({
      id: "delivery_restricted",
      triggered: true,
      reason: `Delivery status '${deliveryState.currentStatus}' restricts tool execution`,
      action: "degrade",
    });
  }

  // 4. Simultaneous incident + compliance escalation → halt pending review
  if (escalationSignals.includes("incident") && escalationSignals.includes("compliance")) {
    conditions.push({
      id: "dual_escalation_halt",
      triggered: true,
      reason: "Simultaneous incident and compliance escalation requires cautious response",
      action: "halt",
    });
  }

  return conditions;
}

// =============================================================================
// Main Entry Point — Resolve Governance Decision
// =============================================================================

export interface GovernanceInput {
  /** Route plan from routeViaAisha() — null when degraded. */
  routePlan: RouteSignal | null;
  /** Risk profile string from route_task params. */
  routePlanRiskProfile: string;
  /** Escalation signals from detectEscalationSignals(). */
  escalationSignals: EscalationSignal[];
  /** Delivery state from story context — null when no story. */
  deliveryState: DeliveryStateSignal | null;
  /** Model selected by selectOptimalModel(). */
  selectedModel: string;
  /** Source of model selection (for tracing). */
  modelSource: string;
  /** Whether model was overridden by admin. */
  isAdminOverride: boolean;
  /** Decision provenance chain from Phase A (optional — for recording). */
  decisionChain?: DecisionChain;
  /** Tao principles from governance_context layer (optional). */
  taoPrinciples?: TaoPrinciple[] | null;
}

/**
 * Resolve a unified governance decision from all orchestration signals.
 *
 * This replaces the ad-hoc RoutePlanHint construction in ai-chat/index.ts
 * and ensures all governance decisions are:
 * 1. Made through a single, auditable decision matrix
 * 2. Recorded in the decision provenance chain
 * 3. Consistent across all subsystems
 *
 * @param input - All orchestration signals
 * @returns Unified governance decision
 */
export function resolveGovernanceDecision(input: GovernanceInput): GovernanceDecision {
  const {
    routePlan,
    routePlanRiskProfile,
    escalationSignals,
    deliveryState,
    selectedModel,
    modelSource,
    isAdminOverride,
    decisionChain,
    taoPrinciples,
  } = input;

  // 0. Derive tao governance constraints
  const taoConstraints = deriveTaoConstraints(taoPrinciples);

  if (taoConstraints) {
    decisionChain?.record(
      "governance_tao",
      `${taoConstraints.sourceSlugs.length}_principles`,
      "core_values",
      "tao_layer",
      `Tao governance: ${taoConstraints.sourceSlugs.length} core values applied`,
    );
  }

  // 1. Resolve risk level
  const { riskLevel, reason: riskReason, ruleId } = resolveRiskLevel({
    routePlan,
    escalationSignals,
    deliveryState,
    routePlanRiskProfile,
  });

  // Record risk decision in provenance chain
  decisionChain?.record(
    "governance_risk_level",
    riskLevel,
    "orchestration_policy",
    `risk_rule:${ruleId}`,
    riskReason,
  );

  // 2. Resolve approval boundary
  const approval = resolveApprovalBoundary(riskLevel, routePlan, deliveryState);

  // Record approval decision in provenance chain
  decisionChain?.record(
    "governance_approval",
    approval.required ? "required" : "not_required",
    approval.source,
    "approval_boundary",
    approval.reason,
  );

  // 3. Evaluate stop conditions
  const stopConditions = evaluateStopConditions(
    riskLevel,
    routePlan,
    deliveryState,
    escalationSignals,
  );

  // Record compliance gate in provenance chain if triggered
  const complianceGate = stopConditions.find((s) => s.id === "compliance_gate");
  if (complianceGate?.triggered) {
    decisionChain?.record(
      "governance_compliance",
      "required",
      "compliance_policy",
      "stop_condition:compliance_gate",
      complianceGate.reason,
    );
  }

  // 4. Determine effective model
  // Admin override takes precedence (recorded as ruleset_snapshot authority)
  // Risk escalation may upgrade the model tier
  let effectiveModel = selectedModel;
  let effectiveModelSource = modelSource;
  const forceAcross = isAdminOverride;

  if (isAdminOverride) {
    decisionChain?.record(
      "governance_model",
      selectedModel,
      "ruleset_snapshot",
      "admin_override",
      "Admin model override",
      true, // force override
    );
    effectiveModelSource = "admin_override";
  } else if (routePlan?.agents?.[0]?.model && riskLevel !== "low") {
    // Route plan model recommendation for non-low risk
    effectiveModel = routePlan.agents[0].model;
    effectiveModelSource = "route_plan_escalation";
    decisionChain?.record(
      "governance_model",
      effectiveModel,
      "orchestration_policy",
      "route_plan",
      `Route plan model for ${riskLevel} risk`,
    );
  } else {
    decisionChain?.record(
      "governance_model",
      effectiveModel,
      "model_heuristic",
      "auto_selection",
      `Auto-selected: ${modelSource}`,
    );
  }

  // 5. Determine tool restrictions
  let toolsAllowlist: string[] | null = null;
  if (routePlan?.toolsAllowlist && routePlan.toolsAllowlist.length > 0) {
    toolsAllowlist = routePlan.toolsAllowlist;
  }
  // Reduce max iterations for high/critical risk
  const baseMaxIterations = routePlan?.stopConditions.max_loops ?? 3;
  const maxToolIterations = riskLevel === "critical" ? 1 : riskLevel === "high" ? 2 : baseMaxIterations;

  // 6. Forced category from route plan
  const forcedCategory = (routePlan as Record<string, unknown> | null)?.forcedCategory as string | null ?? null;

  // Record tool restriction if reduced
  if (maxToolIterations < baseMaxIterations) {
    decisionChain?.record(
      "governance_tool_iterations",
      String(maxToolIterations),
      "compliance_policy",
      `risk_level:${riskLevel}`,
      `Reduced from ${baseMaxIterations} to ${maxToolIterations} due to ${riskLevel} risk`,
    );
  }

  return {
    riskLevel,
    effectiveModel,
    modelSource: effectiveModelSource,
    requireCompliance: complianceGate?.triggered ?? false,
    approval,
    stopConditions,
    toolsAllowlist,
    maxToolIterations,
    forceModelAcrossWorkflow: forceAcross,
    forcedCategory,
    taskKind: "chat",
    runId: routePlan?.runId ?? null,
    deliveryState,
    escalationSignals,
    taoConstraints,
  };
}

/**
 * Convert a GovernanceDecision to a RoutePlanHint for backward compatibility
 * with the existing workflow engine.
 *
 * This adapter function allows incremental adoption — the workflow engine
 * still consumes RoutePlanHint, but the decision is now made by the
 * governance matrix instead of ad-hoc construction.
 */
export function toRoutePlanHint(decision: GovernanceDecision): {
  primaryModel?: string;
  forceModelAcrossWorkflow?: boolean;
  toolsAllowlist?: string[];
  maxToolIterations?: number;
  mustPassCompliance?: boolean;
  requireHumanApproval?: boolean;
  forcedCategory?: string;
  taskKind?: string;
} {
  return {
    primaryModel: decision.effectiveModel ?? undefined,
    forceModelAcrossWorkflow: decision.forceModelAcrossWorkflow || undefined,
    toolsAllowlist: decision.toolsAllowlist ?? undefined,
    maxToolIterations: decision.maxToolIterations,
    mustPassCompliance: decision.requireCompliance || undefined,
    requireHumanApproval: decision.approval.required || undefined,
    forcedCategory: decision.forcedCategory ?? undefined,
    taskKind: decision.taskKind,
  };
}
