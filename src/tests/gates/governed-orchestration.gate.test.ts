/**
 * Governed Orchestration Gate Tests — Phase B
 *
 * Structural validation that governance module is properly integrated
 * into the ai-chat pipeline and follows correctness-first principles.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SHARED_DIR = path.resolve("services/svc-ai-chat/src/lib");
const AI_CHAT_DIR = path.resolve("services/svc-ai-chat/src/routes");

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

describe("Phase B: Governed Orchestration Module Structure", () => {
  const moduleContent = readFile(path.join(SHARED_DIR, "governedOrchestration.ts"));

  it("exports resolveGovernanceDecision function", () => {
    expect(moduleContent).toContain("export function resolveGovernanceDecision");
  });

  it("exports toRoutePlanHint adapter", () => {
    expect(moduleContent).toContain("export function toRoutePlanHint");
  });

  it("exports resolveRiskLevel function", () => {
    expect(moduleContent).toContain("export function resolveRiskLevel");
  });

  it("exports resolveApprovalBoundary function", () => {
    expect(moduleContent).toContain("export function resolveApprovalBoundary");
  });

  it("exports evaluateStopConditions function", () => {
    expect(moduleContent).toContain("export function evaluateStopConditions");
  });

  it("exports GovernanceDecision type", () => {
    expect(moduleContent).toContain("export interface GovernanceDecision");
  });

  it("exports GovernanceInput type", () => {
    expect(moduleContent).toContain("export interface GovernanceInput");
  });

  it("imports from decisionProvenance for provenance integration", () => {
    expect(moduleContent).toMatch(/from\s+['"]\.\/decisionProvenance(?:\.js)?['"]/);
  });

  it("defines all four risk levels", () => {
    expect(moduleContent).toContain('"low"');
    expect(moduleContent).toContain('"medium"');
    expect(moduleContent).toContain('"high"');
    expect(moduleContent).toContain('"critical"');
  });

  it("defines all four escalation signal types", () => {
    expect(moduleContent).toContain('"frustration"');
    expect(moduleContent).toContain('"compliance"');
    expect(moduleContent).toContain('"incident"');
    expect(moduleContent).toContain('"highValue"');
  });

  it("defines approval boundary with required, reason, source", () => {
    expect(moduleContent).toContain("required: boolean");
    expect(moduleContent).toContain("reason: string");
    expect(moduleContent).toContain("source: DecisionSourceType");
  });

  it("defines stop condition with id, triggered, reason, action", () => {
    expect(moduleContent).toContain("id: string");
    expect(moduleContent).toContain("triggered: boolean");
    expect(moduleContent).toContain('action: "halt" | "degrade" | "warn"');
  });
});

describe("Phase B: Risk Rules Coverage", () => {
  const moduleContent = readFile(path.join(SHARED_DIR, "governedOrchestration.ts"));

  it("has compliance_plus_incident rule (critical)", () => {
    expect(moduleContent).toContain("compliance_plus_incident");
  });

  it("has route_plan_high_risk rule", () => {
    expect(moduleContent).toContain("route_plan_high_risk");
  });

  it("has incident_signal rule", () => {
    expect(moduleContent).toContain("incident_signal");
  });

  it("has compliance_signal rule", () => {
    expect(moduleContent).toContain("compliance_signal");
  });

  it("has delivery_blocked rule", () => {
    expect(moduleContent).toContain("delivery_blocked");
  });

  it("has frustration_or_high_value rule", () => {
    expect(moduleContent).toContain("frustration_or_high_value");
  });
});

describe("Phase B: Approval Boundary Delivery Statuses", () => {
  const moduleContent = readFile(path.join(SHARED_DIR, "governedOrchestration.ts"));

  it("gates approval for delivering status", () => {
    expect(moduleContent).toContain('"delivering"');
  });

  it("gates approval for delivered status", () => {
    expect(moduleContent).toContain('"delivered"');
  });

  it("gates approval for archived status", () => {
    expect(moduleContent).toContain('"archived"');
  });
});

describe("Phase B: Stop Conditions", () => {
  const moduleContent = readFile(path.join(SHARED_DIR, "governedOrchestration.ts"));

  it("defines max_loops stop condition", () => {
    expect(moduleContent).toContain('"max_loops"');
  });

  it("defines compliance_gate stop condition", () => {
    expect(moduleContent).toContain('"compliance_gate"');
  });

  it("defines delivery_restricted stop condition", () => {
    expect(moduleContent).toContain('"delivery_restricted"');
  });

  it("defines dual_escalation_halt stop condition", () => {
    expect(moduleContent).toContain('"dual_escalation_halt"');
  });

  it("restricts tool execution for qa status", () => {
    expect(moduleContent).toContain('"qa"');
  });
});

describe("Phase B: AI Chat Pipeline Integration", () => {
  const chatContent = readFile(path.join(AI_CHAT_DIR, "chat.ts"));

  it("imports resolveGovernanceDecision", () => {
    expect(chatContent).toContain("resolveGovernanceDecision");
  });

  it("imports toRoutePlanHint from governance module", () => {
    expect(chatContent).toContain("toRoutePlanHint");
  });

  it("imports GovernanceDecision type", () => {
    expect(chatContent).toContain("GovernanceDecision");
  });

  it("imports from governedOrchestration module", () => {
    expect(chatContent).toMatch(/governedOrchestration(?:\.(?:ts|js))?/);
  });

  it("calls resolveGovernanceDecision in pipeline", () => {
    expect(chatContent).toContain("resolveGovernanceDecision({");
  });

  it("uses toRoutePlanHint for backward compatibility", () => {
    expect(chatContent).toContain("toRoutePlanHint(governanceDecision)");
  });

  it("logs governance decision debug info", () => {
    expect(chatContent).toContain("governance.decision");
  });

  it("logs governance approval when required", () => {
    expect(chatContent).toContain("governance.approval");
  });

  it("records governance risk level in tracer", () => {
    expect(chatContent).toContain("governance_risk_level");
  });

  it("records governance compliance in tracer", () => {
    expect(chatContent).toContain("governance_compliance_required");
  });

  it("records governance approval in tracer", () => {
    expect(chatContent).toContain("governance_approval_required");
  });

  it("records governance stop conditions in tracer", () => {
    expect(chatContent).toContain("governance_stop_conditions_triggered");
  });

  it("no longer constructs RoutePlanHint ad-hoc", () => {
    // The old pattern was `aishaRoutePlan ? { primaryModel: effectiveModel, ...}`
    // Should NOT be present anymore — governance decision handles this
    const adHocPattern = /aishaRoutePlan\s*\?\s*\{[\s\S]*?primaryModel:\s*effectiveModel/;
    expect(adHocPattern.test(chatContent)).toBe(false);
  });
});

describe("Phase B: Provenance Integration", () => {
  const moduleContent = readFile(path.join(SHARED_DIR, "governedOrchestration.ts"));

  it("records governance_risk_level decision", () => {
    expect(moduleContent).toContain('"governance_risk_level"');
  });

  it("records governance_approval decision", () => {
    expect(moduleContent).toContain('"governance_approval"');
  });

  it("records governance_compliance decision", () => {
    expect(moduleContent).toContain('"governance_compliance"');
  });

  it("records governance_model decision", () => {
    expect(moduleContent).toContain('"governance_model"');
  });

  it("supports decisionChain parameter for provenance", () => {
    expect(moduleContent).toContain("decisionChain?");
  });
});

describe("Phase B: No Silent Override Patterns", () => {
  const moduleContent = readFile(path.join(SHARED_DIR, "governedOrchestration.ts"));

  it("risk rules are evaluated in order — first match wins", () => {
    expect(moduleContent).toContain("for (const rule of RISK_RULES)");
  });

  it("tool iterations reduced for high/critical risk", () => {
    expect(moduleContent).toMatch(/riskLevel\s*===\s*"critical"\s*\?\s*1/);
    expect(moduleContent).toMatch(/riskLevel\s*===\s*"high"\s*\?\s*2/);
  });

  it("admin override is explicit (forceOverride=true in provenance)", () => {
    expect(moduleContent).toContain("true, // force override");
  });
});
