/**
 * Governed Orchestration Unit Tests — Phase B
 *
 * Tests the unified governance decision matrix:
 * - Risk resolution from combined signals
 * - Approval boundaries (route plan, critical risk, delivery state)
 * - Stop conditions (compliance gate, delivery restricted, dual escalation)
 * - Full governance decision resolution
 * - RoutePlanHint backward compatibility adapter
 *
 * @module
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline implementation for Node-compatible testing
// (mirrors governedOrchestration.ts types and logic)
// ---------------------------------------------------------------------------

type DecisionSourceType =
  | "ruleset_snapshot"
  | "compliance_policy"
  | "orchestration_policy"
  | "knowledge_retrieval"
  | "model_heuristic"
  | "fallback";

type GovernanceRiskLevel = "low" | "medium" | "high" | "critical";
type EscalationSignal = "frustration" | "compliance" | "incident" | "highValue";

interface RouteSignal {
  runId: string;
  agents: Array<{ slug: string; model: string; context_profile: string; step_index: number }>;
  toolsAllowlist: string[];
  stopConditions: {
    max_loops: number;
    must_pass_compliance: boolean;
    require_human_approval: boolean;
  };
}

interface DeliveryStateSignal {
  storyId: string;
  currentStatus: string | null;
  allowedTransitions?: Array<{ to_status: string; requires_role: string | null }>;
}

interface ApprovalBoundary {
  required: boolean;
  reason: string;
  source: DecisionSourceType;
}

interface StopCondition {
  id: string;
  triggered: boolean;
  reason: string;
  action: "halt" | "degrade" | "warn";
}

interface GovernanceDecision {
  riskLevel: GovernanceRiskLevel;
  effectiveModel: string | null;
  modelSource: string;
  requireCompliance: boolean;
  approval: ApprovalBoundary;
  stopConditions: StopCondition[];
  toolsAllowlist: string[] | null;
  maxToolIterations: number;
  forceModelAcrossWorkflow: boolean;
  forcedCategory: string | null;
  taskKind: string;
  runId: string | null;
  deliveryState: DeliveryStateSignal | null;
  escalationSignals: EscalationSignal[];
}

// --- Risk Resolution ---

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

function resolveRiskLevel(ctx: RiskResolutionContext) {
  for (const rule of RISK_RULES) {
    if (rule.condition(ctx)) {
      return { riskLevel: rule.riskLevel, reason: rule.reason, ruleId: rule.id };
    }
  }
  return { riskLevel: "low" as GovernanceRiskLevel, reason: "No risk signals detected", ruleId: "default" };
}

// --- Approval Boundaries ---

const APPROVAL_REQUIRED_STATUSES = new Set(["delivering", "delivered", "archived"]);

function resolveApprovalBoundary(
  riskLevel: GovernanceRiskLevel,
  routePlan: RouteSignal | null,
  deliveryState: DeliveryStateSignal | null,
): ApprovalBoundary {
  if (routePlan?.stopConditions.require_human_approval) {
    return { required: true, reason: "Route plan mandates human approval", source: "orchestration_policy" };
  }
  if (riskLevel === "critical") {
    return { required: true, reason: "Critical risk level requires human approval", source: "compliance_policy" };
  }
  if (deliveryState?.currentStatus && APPROVAL_REQUIRED_STATUSES.has(deliveryState.currentStatus)) {
    return {
      required: true,
      reason: `Delivery status '${deliveryState.currentStatus}' requires approval for actions`,
      source: "orchestration_policy",
    };
  }
  return { required: false, reason: "No approval required for current context", source: "orchestration_policy" };
}

// --- Stop Conditions ---

const RESTRICTED_ACTION_STATUSES = new Set(["qa", "delivering", "delivered"]);

function evaluateStopConditions(
  riskLevel: GovernanceRiskLevel,
  routePlan: RouteSignal | null,
  deliveryState: DeliveryStateSignal | null,
  escalationSignals: EscalationSignal[],
): StopCondition[] {
  const conditions: StopCondition[] = [];
  const maxLoops = routePlan?.stopConditions.max_loops ?? 3;
  conditions.push({ id: "max_loops", triggered: false, reason: `Maximum ${maxLoops} tool iterations allowed`, action: "halt" });

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

  if (deliveryState?.currentStatus && RESTRICTED_ACTION_STATUSES.has(deliveryState.currentStatus)) {
    conditions.push({
      id: "delivery_restricted",
      triggered: true,
      reason: `Delivery status '${deliveryState.currentStatus}' restricts tool execution`,
      action: "degrade",
    });
  }

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

// --- Full governance resolution ---

function resolveGovernanceDecision(input: {
  routePlan: RouteSignal | null;
  routePlanRiskProfile: string;
  escalationSignals: EscalationSignal[];
  deliveryState: DeliveryStateSignal | null;
  selectedModel: string;
  modelSource: string;
  isAdminOverride: boolean;
}): GovernanceDecision {
  const {
    routePlan, routePlanRiskProfile, escalationSignals, deliveryState,
    selectedModel, modelSource, isAdminOverride,
  } = input;

  const { riskLevel } = resolveRiskLevel({ routePlan, escalationSignals, deliveryState, routePlanRiskProfile });
  const approval = resolveApprovalBoundary(riskLevel, routePlan, deliveryState);
  const stopConditions = evaluateStopConditions(riskLevel, routePlan, deliveryState, escalationSignals);

  const complianceGate = stopConditions.find((s) => s.id === "compliance_gate");

  let effectiveModel = selectedModel;
  let effectiveModelSource = modelSource;
  const forceAcross = isAdminOverride;

  if (isAdminOverride) {
    effectiveModelSource = "admin_override";
  } else if (routePlan?.agents?.[0]?.model && riskLevel !== "low") {
    effectiveModel = routePlan.agents[0].model;
    effectiveModelSource = "route_plan_escalation";
  }

  const baseMaxIterations = routePlan?.stopConditions.max_loops ?? 3;
  const maxToolIterations = riskLevel === "critical" ? 1 : riskLevel === "high" ? 2 : baseMaxIterations;

  return {
    riskLevel,
    effectiveModel,
    modelSource: effectiveModelSource,
    requireCompliance: complianceGate?.triggered ?? false,
    approval,
    stopConditions,
    toolsAllowlist: routePlan?.toolsAllowlist?.length ? routePlan.toolsAllowlist : null,
    maxToolIterations,
    forceModelAcrossWorkflow: forceAcross,
    forcedCategory: null,
    taskKind: "chat",
    runId: routePlan?.runId ?? null,
    deliveryState,
    escalationSignals,
  };
}

function toRoutePlanHint(decision: GovernanceDecision) {
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

// ===========================================================================
// Helper factory
// ===========================================================================

function makeRoutePlan(overrides: Partial<RouteSignal> = {}): RouteSignal {
  return {
    runId: "test-run-1",
    agents: [{ slug: "main_agent", model: "claude-sonnet-4", context_profile: "chat_default", step_index: 0 }],
    toolsAllowlist: [],
    stopConditions: { max_loops: 3, must_pass_compliance: false, require_human_approval: false },
    ...overrides,
  };
}

function makeDeliveryState(status: string | null, overrides: Partial<DeliveryStateSignal> = {}): DeliveryStateSignal {
  return { storyId: "story-1", currentStatus: status, ...overrides };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Risk Resolution", () => {
  it("returns low when no signals", () => {
    const result = resolveRiskLevel({
      routePlan: null,
      escalationSignals: [],
      deliveryState: null,
      routePlanRiskProfile: "low",
    });
    expect(result.riskLevel).toBe("low");
    expect(result.ruleId).toBe("default");
  });

  it("returns critical for compliance + incident", () => {
    const result = resolveRiskLevel({
      routePlan: null,
      escalationSignals: ["compliance", "incident"],
      deliveryState: null,
      routePlanRiskProfile: "low",
    });
    expect(result.riskLevel).toBe("critical");
    expect(result.ruleId).toBe("compliance_plus_incident");
  });

  it("returns high for route plan high risk", () => {
    const result = resolveRiskLevel({
      routePlan: makeRoutePlan(),
      escalationSignals: [],
      deliveryState: null,
      routePlanRiskProfile: "high",
    });
    expect(result.riskLevel).toBe("high");
  });

  it("returns high for incident signal alone", () => {
    const result = resolveRiskLevel({
      routePlan: null,
      escalationSignals: ["incident"],
      deliveryState: null,
      routePlanRiskProfile: "low",
    });
    expect(result.riskLevel).toBe("high");
  });

  it("returns medium for blocked delivery", () => {
    const result = resolveRiskLevel({
      routePlan: null,
      escalationSignals: [],
      deliveryState: makeDeliveryState("blocked"),
      routePlanRiskProfile: "low",
    });
    expect(result.riskLevel).toBe("medium");
  });

  it("returns medium for frustration signal", () => {
    const result = resolveRiskLevel({
      routePlan: null,
      escalationSignals: ["frustration"],
      deliveryState: null,
      routePlanRiskProfile: "low",
    });
    expect(result.riskLevel).toBe("medium");
  });

  it("highest signal wins (critical > high)", () => {
    // compliance + incident = critical, even though incident alone = high
    const result = resolveRiskLevel({
      routePlan: null,
      escalationSignals: ["compliance", "incident", "frustration"],
      deliveryState: null,
      routePlanRiskProfile: "high",
    });
    expect(result.riskLevel).toBe("critical");
  });
});

describe("Approval Boundaries", () => {
  it("not required by default", () => {
    const result = resolveApprovalBoundary("low", null, null);
    expect(result.required).toBe(false);
  });

  it("required when route plan mandates", () => {
    const rp = makeRoutePlan({ stopConditions: { max_loops: 3, must_pass_compliance: false, require_human_approval: true } });
    const result = resolveApprovalBoundary("low", rp, null);
    expect(result.required).toBe(true);
    expect(result.source).toBe("orchestration_policy");
  });

  it("required for critical risk", () => {
    const result = resolveApprovalBoundary("critical", null, null);
    expect(result.required).toBe(true);
    expect(result.source).toBe("compliance_policy");
  });

  it("required for delivering delivery status", () => {
    const result = resolveApprovalBoundary("low", null, makeDeliveryState("delivering"));
    expect(result.required).toBe(true);
  });

  it("required for delivered delivery status", () => {
    const result = resolveApprovalBoundary("low", null, makeDeliveryState("delivered"));
    expect(result.required).toBe(true);
  });

  it("required for archived delivery status", () => {
    const result = resolveApprovalBoundary("low", null, makeDeliveryState("archived"));
    expect(result.required).toBe(true);
  });

  it("not required for in_progress delivery status", () => {
    const result = resolveApprovalBoundary("low", null, makeDeliveryState("in_progress"));
    expect(result.required).toBe(false);
  });
});

describe("Stop Conditions", () => {
  it("always includes max_loops (not triggered)", () => {
    const conds = evaluateStopConditions("low", null, null, []);
    expect(conds.some((c) => c.id === "max_loops")).toBe(true);
    expect(conds.find((c) => c.id === "max_loops")!.triggered).toBe(false);
  });

  it("compliance gate triggered for high risk", () => {
    const conds = evaluateStopConditions("high", null, null, []);
    expect(conds.some((c) => c.id === "compliance_gate" && c.triggered)).toBe(true);
  });

  it("compliance gate triggered for critical risk", () => {
    const conds = evaluateStopConditions("critical", null, null, []);
    expect(conds.some((c) => c.id === "compliance_gate" && c.triggered)).toBe(true);
  });

  it("compliance gate triggered when route plan requires", () => {
    const rp = makeRoutePlan({ stopConditions: { max_loops: 3, must_pass_compliance: true, require_human_approval: false } });
    const conds = evaluateStopConditions("low", rp, null, []);
    expect(conds.some((c) => c.id === "compliance_gate" && c.triggered)).toBe(true);
  });

  it("no compliance gate for low risk without flag", () => {
    const conds = evaluateStopConditions("low", null, null, []);
    expect(conds.some((c) => c.id === "compliance_gate")).toBe(false);
  });

  it("delivery restricted for qa status", () => {
    const conds = evaluateStopConditions("low", null, makeDeliveryState("qa"), []);
    expect(conds.some((c) => c.id === "delivery_restricted" && c.triggered)).toBe(true);
  });

  it("dual escalation halt", () => {
    const conds = evaluateStopConditions("critical", null, null, ["incident", "compliance"]);
    expect(conds.some((c) => c.id === "dual_escalation_halt" && c.triggered)).toBe(true);
    expect(conds.find((c) => c.id === "dual_escalation_halt")!.action).toBe("halt");
  });
});

describe("Full Governance Decision", () => {
  it("low risk, no signals → default happy path", () => {
    const decision = resolveGovernanceDecision({
      routePlan: null,
      routePlanRiskProfile: "low",
      escalationSignals: [],
      deliveryState: null,
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    expect(decision.riskLevel).toBe("low");
    expect(decision.effectiveModel).toBe("gpt-5-mini");
    expect(decision.requireCompliance).toBe(false);
    expect(decision.approval.required).toBe(false);
    expect(decision.maxToolIterations).toBe(3);
  });

  it("high risk → compliance required, tool iterations reduced", () => {
    const decision = resolveGovernanceDecision({
      routePlan: makeRoutePlan(),
      routePlanRiskProfile: "high",
      escalationSignals: [],
      deliveryState: null,
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    expect(decision.riskLevel).toBe("high");
    expect(decision.requireCompliance).toBe(true);
    expect(decision.maxToolIterations).toBe(2);
    // Route plan model should be used for non-low risk
    expect(decision.effectiveModel).toBe("claude-sonnet-4");
    expect(decision.modelSource).toBe("route_plan_escalation");
  });

  it("critical risk → approval required, tool iterations = 1", () => {
    const decision = resolveGovernanceDecision({
      routePlan: null,
      routePlanRiskProfile: "low",
      escalationSignals: ["compliance", "incident"],
      deliveryState: null,
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    expect(decision.riskLevel).toBe("critical");
    expect(decision.approval.required).toBe(true);
    expect(decision.maxToolIterations).toBe(1);
    expect(decision.requireCompliance).toBe(true);
  });

  it("admin override takes precedence", () => {
    const decision = resolveGovernanceDecision({
      routePlan: makeRoutePlan(),
      routePlanRiskProfile: "high",
      escalationSignals: [],
      deliveryState: null,
      selectedModel: "local-llama",
      modelSource: "override",
      isAdminOverride: true,
    });
    expect(decision.effectiveModel).toBe("local-llama");
    expect(decision.modelSource).toBe("admin_override");
    expect(decision.forceModelAcrossWorkflow).toBe(true);
  });

  it("delivery blocked → medium risk", () => {
    const decision = resolveGovernanceDecision({
      routePlan: null,
      routePlanRiskProfile: "low",
      escalationSignals: [],
      deliveryState: makeDeliveryState("blocked"),
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    expect(decision.riskLevel).toBe("medium");
  });

  it("tools allowlist from route plan", () => {
    const rp = makeRoutePlan({ toolsAllowlist: ["search_knowledge", "get_expert_rule"] });
    const decision = resolveGovernanceDecision({
      routePlan: rp,
      routePlanRiskProfile: "low",
      escalationSignals: [],
      deliveryState: null,
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    expect(decision.toolsAllowlist).toEqual(["search_knowledge", "get_expert_rule"]);
  });
});

describe("RoutePlanHint Adapter", () => {
  it("converts governance decision to backward-compatible hint", () => {
    const decision = resolveGovernanceDecision({
      routePlan: makeRoutePlan(),
      routePlanRiskProfile: "high",
      escalationSignals: [],
      deliveryState: null,
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    const hint = toRoutePlanHint(decision);
    expect(hint.primaryModel).toBe("claude-sonnet-4"); // escalated
    expect(hint.mustPassCompliance).toBe(true);
    expect(hint.maxToolIterations).toBe(2);
    expect(hint.taskKind).toBe("chat");
  });

  it("omits undefined fields", () => {
    const decision = resolveGovernanceDecision({
      routePlan: null,
      routePlanRiskProfile: "low",
      escalationSignals: [],
      deliveryState: null,
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    const hint = toRoutePlanHint(decision);
    expect(hint.toolsAllowlist).toBeUndefined();
    expect(hint.mustPassCompliance).toBeUndefined();
    expect(hint.requireHumanApproval).toBeUndefined();
    expect(hint.forceModelAcrossWorkflow).toBeUndefined();
    expect(hint.forcedCategory).toBeUndefined();
  });
});

// ===========================================================================
// Golden Scenario: Chat Delegation Conflict Resolution
// ===========================================================================

describe("Golden Scenario: Conflict Resolution", () => {
  it("incident + compliance → critical → approval + compliance + halt", () => {
    const decision = resolveGovernanceDecision({
      routePlan: null,
      routePlanRiskProfile: "low",
      escalationSignals: ["incident", "compliance"],
      deliveryState: null,
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    // Risk
    expect(decision.riskLevel).toBe("critical");
    // Approval required
    expect(decision.approval.required).toBe(true);
    expect(decision.approval.source).toBe("compliance_policy");
    // Compliance gate
    expect(decision.requireCompliance).toBe(true);
    // Dual escalation halt
    expect(decision.stopConditions.some((s) => s.id === "dual_escalation_halt" && s.triggered)).toBe(true);
    // Tool iterations capped to 1
    expect(decision.maxToolIterations).toBe(1);
  });

  it("frustration + delivering → medium risk + approval required", () => {
    const decision = resolveGovernanceDecision({
      routePlan: null,
      routePlanRiskProfile: "low",
      escalationSignals: ["frustration"],
      deliveryState: makeDeliveryState("delivering"),
      selectedModel: "gpt-5-mini",
      modelSource: "auto",
      isAdminOverride: false,
    });
    expect(decision.riskLevel).toBe("medium");
    expect(decision.approval.required).toBe(true);
    expect(decision.approval.reason).toContain("delivering");
  });
});
