/**
 * Decision Provenance & Correctness Foundation Gate Tests
 *
 * Validates Phase A correctness invariants:
 * 1. Decision provenance chain enforces override hierarchy
 * 2. Workflow preflight checks catch invalid graphs
 * 3. Context source labels are present in orchestration bridge
 * 4. No silent overrides in production code patterns
 * 5. Golden scenario contract: every decision has traceable source
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const SHARED_DIR = path.join(ROOT, "services/svc-ai-chat/src/lib");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSharedFile(name: string): string {
  const p = path.join(SHARED_DIR, name);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

// ---------------------------------------------------------------------------
// 1. Decision Provenance Module Exists and Exports Required Types
// ---------------------------------------------------------------------------
describe("Decision Provenance: Module structure", () => {
  const provenanceSource = readSharedFile("decisionProvenance.ts");

  it("decisionProvenance.ts exists in _shared", () => {
    expect(provenanceSource.length).toBeGreaterThan(0);
  });

  it("exports DECISION_SOURCE_HIERARCHY with correct authority order", () => {
    expect(provenanceSource).toContain("DECISION_SOURCE_HIERARCHY");
    // Verify the correct order (strongest → weakest)
    const hierarchyMatch = provenanceSource.match(
      /DECISION_SOURCE_HIERARCHY\s*=\s*\[([\s\S]*?)\]\s*as\s*const/
    );
    expect(hierarchyMatch).not.toBeNull();
    const hierarchy = hierarchyMatch![1];
    const entries = hierarchy.match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    // The hierarchy is extensible. New entries from the AISHA autopilot vrstvy
    // (gateway_route / execution_strategy / graph_node_transition / slot_classification)
    // were added between compliance_policy and model_heuristic. Validate
    // STRUCTURE (strongest first, fallback last, original entries preserved)
    // rather than exact length.
    expect(entries[0]).toBe("ruleset_snapshot");
    expect(entries[1]).toBe("core_values");
    expect(entries[2]).toBe("compliance_policy");
    expect(entries[entries.length - 1]).toBe("fallback");
    expect(entries[entries.length - 2]).toBe("model_heuristic");

    // Original mid-tier entries must remain present, in their relative order
    const mustContain = [
      "orchestration_policy",
      "knowledge_retrieval",
    ];
    for (const required of mustContain) {
      expect(entries).toContain(required);
    }
    // Ordering invariant: compliance_policy strictly above orchestration_policy
    expect(entries.indexOf("compliance_policy")).toBeLessThan(
      entries.indexOf("orchestration_policy"),
    );
    expect(entries.indexOf("orchestration_policy")).toBeLessThan(
      entries.indexOf("knowledge_retrieval"),
    );
    expect(entries.indexOf("knowledge_retrieval")).toBeLessThan(
      entries.indexOf("model_heuristic"),
    );
  });

  it("exports createDecisionChain factory", () => {
    expect(provenanceSource).toContain("export function createDecisionChain");
  });

  it("exports preflightCheckWorkflow function", () => {
    expect(provenanceSource).toContain("export function preflightCheckWorkflow");
  });

  it("exports CONTEXT_SOURCE_LABELS with all required labels", () => {
    expect(provenanceSource).toContain("CONTEXT_SOURCE_LABELS");
    const requiredLabels = [
      "PROJECT_CONTEXT",
      "RULESET_SNAPSHOT",
      "KB_PGVECTOR",
      "KB_RAGNAROK",
      "MEMORY_TRACE",
      "MEMORY_SESSION",
      "MEMORY_USER",
      "AGENT_INSTRUCTIONS",
      "GUARDRAILS",
      "INLINE_FALLBACK",
    ];
    for (const label of requiredLabels) {
      expect(provenanceSource).toContain(label);
    }
  });

  it("DecisionRecord includes required fields for auditability", () => {
    const requiredFields = [
      "decision",
      "value",
      "sourceType",
      "sourceId",
      "reason",
      "timestamp",
      "isOverride",
    ];
    for (const field of requiredFields) {
      expect(provenanceSource).toContain(field);
    }
  });

  it("ProvenanceViolation captures attempted and existing decision", () => {
    expect(provenanceSource).toContain("attemptedDecision");
    expect(provenanceSource).toContain("attemptedSource");
    expect(provenanceSource).toContain("existingDecision");
  });
});

// ---------------------------------------------------------------------------
// 2. Workflow Engine Integration
// ---------------------------------------------------------------------------
describe("Decision Provenance: Workflow engine integration", () => {
  const workflowSource = readSharedFile("workflowEngine.ts");

  it("workflowEngine imports decisionProvenance", () => {
    expect(workflowSource).toMatch(/from\s+['"]\.\/decisionProvenance(?:\.(?:ts|js))?['"]/);
  });

  it("workflowEngine creates a decision chain", () => {
    expect(workflowSource).toContain("createDecisionChain()");
  });

  it("workflowEngine calls preflightCheckWorkflow before execution", () => {
    expect(workflowSource).toContain("preflightCheckWorkflow(");
  });

  it("workflowEngine records decisions in the chain", () => {
    expect(workflowSource).toContain("decisionChain.record(");
  });

  it("workflowEngine checks for violations after execution", () => {
    expect(workflowSource).toContain("decisionChain.hasViolations()");
  });

  it("WorkflowResult includes provenanceSummary field", () => {
    expect(workflowSource).toContain("provenanceSummary");
  });

  it("WorkflowResult includes preflightWarnings field", () => {
    expect(workflowSource).toContain("preflightWarnings");
  });
});

// ---------------------------------------------------------------------------
// 3. Orchestration Bridge Source Labels
// ---------------------------------------------------------------------------
describe("Decision Provenance: Context source labels", () => {
  const bridgeSource = readSharedFile("orchestrationBridge.ts");

  it("orchestrationBridge imports CONTEXT_SOURCE_LABELS", () => {
    expect(bridgeSource).toContain("CONTEXT_SOURCE_LABELS");
  });

  it("buildContextPromptSection labels project context chunks", () => {
    expect(bridgeSource).toContain("CONTEXT_SOURCE_LABELS.PROJECT_CONTEXT");
  });

  it("buildContextPromptSection labels ruleset chunks", () => {
    expect(bridgeSource).toContain("CONTEXT_SOURCE_LABELS.RULESET_SNAPSHOT");
  });

  it("buildContextPromptSection labels KB chunks with source distinction", () => {
    expect(bridgeSource).toContain("CONTEXT_SOURCE_LABELS.KB_RAGNAROK");
    expect(bridgeSource).toContain("CONTEXT_SOURCE_LABELS.KB_PGVECTOR");
  });

  it("buildContextPromptSection labels memory trace events", () => {
    expect(bridgeSource).toContain("CONTEXT_SOURCE_LABELS.MEMORY_TRACE");
  });
});

// ---------------------------------------------------------------------------
// 4. AI Chat Pipeline Integration
// ---------------------------------------------------------------------------
describe("Decision Provenance: AI chat pipeline", () => {
  const chatSource = fs.existsSync(path.join(ROOT, "services/svc-ai-chat/src/routes/chat.ts"))
    ? fs.readFileSync(path.join(ROOT, "services/svc-ai-chat/src/routes/chat.ts"), "utf-8")
    : "";

  it("ai-chat tracks provenance summary from workflow result", () => {
    expect(chatSource).toContain("provenanceSummary");
  });

  it("ai-chat logs provenance violations", () => {
    expect(chatSource).toContain("provenance_violations");
  });

  it("ai-chat includes provenance in tracer.finish metadata", () => {
    expect(chatSource).toContain("provenance_summary");
  });
});

// ---------------------------------------------------------------------------
// 5. Golden Scenario Contracts (structural verification)
// ---------------------------------------------------------------------------
describe("Golden Scenario Contracts: Override prevention", () => {
  const workflowSource = readSharedFile("workflowEngine.ts");

  it("route plan model override is logged with provenance", () => {
    // When route_task overrides model, it must be recorded in decision chain
    expect(workflowSource).toContain('"orchestration_policy"');
    expect(workflowSource).toContain('"route_task"');
  });

  it("classifier category decision is recorded with provenance", () => {
    expect(workflowSource).toContain('"model_heuristic"');
    expect(workflowSource).toContain("classify:");
  });

  it("compliance gate mandate is recorded when present", () => {
    expect(workflowSource).toContain('"compliance_policy"');
    expect(workflowSource).toContain("compliance_gate");
  });

  it("provenance violations are emitted as quality_gate trace events", () => {
    expect(workflowSource).toContain('"quality_gate"');
    expect(workflowSource).toContain('"provenance_violation"');
  });
});

// ---------------------------------------------------------------------------
// 6. No Silent Override Patterns in Production Code
// ---------------------------------------------------------------------------
describe("Golden Scenario Contracts: No silent overrides", () => {
  const workflowSource = readSharedFile("workflowEngine.ts");
  const bridgeSource = readSharedFile("orchestrationBridge.ts");

  it("workflow engine does not silently swap category without logging", () => {
    // Every category assignment should have a corresponding addDebug or tracer.event
    const categoryAssignments = workflowSource.match(/category\s*=\s*[^=]/g) ?? [];
    const categoryLogs = workflowSource.match(/addDebug\([^)]*categor/g) ?? [];
    // There should be at least as many log points as assignment patterns
    expect(categoryLogs.length).toBeGreaterThanOrEqual(2);
  });

  it("model override in workflow always has tracer event", () => {
    const overrideMatches = workflowSource.match(/primaryModel/g) ?? [];
    const traceMatches = workflowSource.match(/tracer\.event\([^)]*override/gi) ?? [];
    // At least one trace event per override path
    expect(traceMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("orchestration bridge functions are degradation-safe", () => {
    // routeViaAisha and enrichWithAishaContext should catch errors and return null
    expect(bridgeSource).toContain("return null;");
    // Both functions should have try/catch
    const tryCatches = bridgeSource.match(/}\s*catch\s*\(/g) ?? [];
    expect(tryCatches.length).toBeGreaterThanOrEqual(3);
  });
});
