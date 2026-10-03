/**
 * Decision Provenance Unit Tests
 *
 * Tests the core correctness logic:
 * - Decision chain records decisions with provenance
 * - Override hierarchy prevents weaker sources from overriding stronger
 * - Forced overrides (escalation) bypass hierarchy
 * - Preflight checks validate workflow graphs
 * - Trace summary output format
 *
 * @module
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";

// Import from the Deno-targeted module via path alias
// In Vitest/Node context, we re-export the logic for testing.
// The actual module uses Deno imports — we test the algorithm directly here.

// ---------------------------------------------------------------------------
// Inline implementation for Node-compatible testing
// (mirrors decisionProvenance.ts types and logic exactly)
// ---------------------------------------------------------------------------

const DECISION_SOURCE_HIERARCHY = [
  "ruleset_snapshot",
  "compliance_policy",
  "orchestration_policy",
  "knowledge_retrieval",
  "model_heuristic",
  "fallback",
] as const;

type DecisionSourceType = typeof DECISION_SOURCE_HIERARCHY[number];

interface DecisionRecord {
  id: string;
  decision: string;
  value: string;
  sourceType: DecisionSourceType;
  sourceId: string;
  reason: string;
  timestamp: string;
  isOverride: boolean;
  overriddenDecisionId?: string;
  overrideJustification?: string;
}

interface ProvenanceViolation {
  attemptedDecision: string;
  attemptedSource: DecisionSourceType;
  existingDecision: DecisionRecord;
  reason: string;
  timestamp: string;
}

type RecordResult =
  | { ok: true; record: DecisionRecord }
  | { ok: false; violation: ProvenanceViolation };

function createDecisionChain() {
  const decisions: DecisionRecord[] = [];
  const violations: ProvenanceViolation[] = [];
  const latestByDecision = new Map<string, DecisionRecord>();

  function getAuthorityRank(source: DecisionSourceType): number {
    const idx = DECISION_SOURCE_HIERARCHY.indexOf(source);
    return idx === -1 ? DECISION_SOURCE_HIERARCHY.length : idx;
  }

  function record(
    decision: string,
    value: string,
    sourceType: DecisionSourceType,
    sourceId: string,
    reason: string,
    forceOverride = false,
  ): RecordResult {
    const existing = latestByDecision.get(decision);
    const now = new Date().toISOString();

    if (existing && existing.value !== value) {
      const existingRank = getAuthorityRank(existing.sourceType);
      const newRank = getAuthorityRank(sourceType);

      if (newRank > existingRank && !forceOverride) {
        const violation: ProvenanceViolation = {
          attemptedDecision: decision,
          attemptedSource: sourceType,
          existingDecision: existing,
          reason: `${sourceType} (rank ${newRank}) cannot override ${existing.sourceType} (rank ${existingRank}) for '${decision}'`,
          timestamp: now,
        };
        violations.push(violation);
        return { ok: false, violation };
      }
    }

    const rec: DecisionRecord = {
      id: randomUUID(),
      decision,
      value,
      sourceType,
      sourceId,
      reason,
      timestamp: now,
      isOverride: existing !== undefined && existing.value !== value,
      overriddenDecisionId: existing && existing.value !== value ? existing.id : undefined,
      overrideJustification: existing && existing.value !== value
        ? (forceOverride ? `escalation: ${reason}` : reason)
        : undefined,
    };

    decisions.push(rec);
    latestByDecision.set(decision, rec);
    return { ok: true, record: rec };
  }

  function getDecision(decision: string): DecisionRecord | undefined {
    return latestByDecision.get(decision);
  }

  function getAll(): readonly DecisionRecord[] {
    return decisions;
  }

  function getViolations(): readonly ProvenanceViolation[] {
    return violations;
  }

  function hasViolations(): boolean {
    return violations.length > 0;
  }

  function toTraceSummary() {
    return {
      decisions: decisions.map((d) => ({
        decision: d.decision,
        value: d.value,
        source: d.sourceType,
        sourceId: d.sourceId,
        override: d.isOverride,
      })),
      violations: violations.map((v) => ({
        decision: v.attemptedDecision,
        attempted: v.attemptedSource,
        blocked_by: v.existingDecision.sourceType,
        reason: v.reason,
      })),
    };
  }

  return { record, getDecision, getAll, getViolations, hasViolations, toTraceSummary };
}

// ---------------------------------------------------------------------------
// Preflight check (mirrors the Deno module)
// ---------------------------------------------------------------------------
interface MinimalNode {
  type: string;
  next?: string | null;
  transitions?: Record<string, string>;
  children?: string | string[];
  agent?: string;
  target_node?: string;
}

function preflightCheckWorkflow(
  graph: { entry: string; nodes: Record<string, MinimalNode> },
  availableAgentNames: string[],
  _availableCategories: string[],
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(Object.keys(graph.nodes));

  if (!nodeIds.has(graph.entry)) {
    errors.push(`Entry node '${graph.entry}' not found in graph`);
  }

  const reachable = new Set<string>();
  const queue = [graph.entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const node = graph.nodes[current];
    if (!node) continue;
    if (node.next && nodeIds.has(node.next)) queue.push(node.next);
    if (node.transitions) {
      for (const target of Object.values(node.transitions)) {
        if (nodeIds.has(target)) queue.push(target);
      }
    }
    if (node.target_node && nodeIds.has(node.target_node)) queue.push(node.target_node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (nodeIds.has(child)) queue.push(child);
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) {
      warnings.push(`Node '${nodeId}' is unreachable from entry '${graph.entry}'`);
    }
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.next && !nodeIds.has(node.next)) {
      errors.push(`Node '${nodeId}' references non-existent next node '${node.next}'`);
    }
    if (node.type === "classifier") {
      if (!node.transitions || Object.keys(node.transitions).length === 0) {
        errors.push(`Classifier node '${nodeId}' has no transitions defined`);
      } else {
        for (const [key, target] of Object.entries(node.transitions)) {
          if (!nodeIds.has(target)) {
            errors.push(`Classifier '${nodeId}' transition '${key}' → '${target}' targets non-existent node`);
          }
        }
      }
    }
    if (node.type === "agent" && node.agent) {
      const specialTokens = ["__from_category__"];
      if (!specialTokens.includes(node.agent) && !availableAgentNames.includes(node.agent)) {
        warnings.push(`Agent node '${nodeId}' references agent '${node.agent}' not found in active configurations`);
      }
    }
    if (node.type === "critic" && node.target_node) {
      if (!nodeIds.has(node.target_node)) {
        errors.push(`Critic node '${nodeId}' target_node '${node.target_node}' not found in graph`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("DecisionChain: Basic recording", () => {
  it("records a decision and returns it", () => {
    const chain = createDecisionChain();
    const result = chain.record("model_selection", "gpt-5-mini", "model_heuristic", "auto", "greeting detected");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.decision).toBe("model_selection");
      expect(result.record.value).toBe("gpt-5-mini");
      expect(result.record.sourceType).toBe("model_heuristic");
      expect(result.record.isOverride).toBe(false);
    }
  });

  it("getDecision returns latest decision", () => {
    const chain = createDecisionChain();
    chain.record("category", "Medical", "model_heuristic", "classify", "LLM classified");

    const dec = chain.getDecision("category");
    expect(dec).toBeDefined();
    expect(dec!.value).toBe("Medical");
  });

  it("getAll returns decisions in order", () => {
    const chain = createDecisionChain();
    chain.record("a", "1", "fallback", "x", "first");
    chain.record("b", "2", "fallback", "y", "second");

    const all = chain.getAll();
    expect(all.length).toBe(2);
    expect(all[0].decision).toBe("a");
    expect(all[1].decision).toBe("b");
  });
});

describe("DecisionChain: Override hierarchy enforcement", () => {
  it("allows stronger source to override weaker", () => {
    const chain = createDecisionChain();
    chain.record("model_selection", "gpt-5-mini", "model_heuristic", "auto", "greeting");
    const result = chain.record("model_selection", "claude-sonnet-4", "compliance_policy", "risk", "high risk");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.isOverride).toBe(true);
      expect(result.record.value).toBe("claude-sonnet-4");
    }
  });

  it("blocks weaker source from overriding stronger", () => {
    const chain = createDecisionChain();
    chain.record("model_selection", "claude-sonnet-4", "compliance_policy", "risk", "high risk");
    const result = chain.record("model_selection", "gpt-5-mini", "fallback", "default", "revert");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violation.attemptedSource).toBe("fallback");
      expect(result.violation.existingDecision.sourceType).toBe("compliance_policy");
    }
  });

  it("allows same-level source to override", () => {
    const chain = createDecisionChain();
    chain.record("category", "Medical", "model_heuristic", "classify1", "first try");
    const result = chain.record("category", "Financial", "model_heuristic", "classify2", "re-classify");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.isOverride).toBe(true);
    }
  });

  it("allows same value from weaker source (not an override)", () => {
    const chain = createDecisionChain();
    chain.record("model_selection", "gpt-5-mini", "orchestration_policy", "route", "route plan");
    const result = chain.record("model_selection", "gpt-5-mini", "fallback", "default", "same value");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same value → not treated as override
      expect(result.record.isOverride).toBe(false);
    }
  });

  it("forceOverride bypasses hierarchy", () => {
    const chain = createDecisionChain();
    chain.record("model_selection", "claude-sonnet-4", "compliance_policy", "risk", "high risk");
    const result = chain.record("model_selection", "gpt-5-mini", "fallback", "escalation", "emergency", true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.isOverride).toBe(true);
      expect(result.record.overrideJustification).toContain("escalation");
    }
  });
});

describe("DecisionChain: Violations tracking", () => {
  it("hasViolations returns false when no violations", () => {
    const chain = createDecisionChain();
    chain.record("a", "1", "fallback", "x", "ok");
    expect(chain.hasViolations()).toBe(false);
  });

  it("hasViolations returns true after blocked override", () => {
    const chain = createDecisionChain();
    chain.record("model", "strong", "ruleset_snapshot", "rs1", "pinned");
    chain.record("model", "weak", "fallback", "fb", "try override");
    expect(chain.hasViolations()).toBe(true);
    expect(chain.getViolations().length).toBe(1);
  });

  it("effective decision unchanged after violation", () => {
    const chain = createDecisionChain();
    chain.record("model", "strong-model", "compliance_policy", "cp", "compliance");
    chain.record("model", "weak-model", "model_heuristic", "auto", "try override");
    // The effective decision should remain the stronger one
    expect(chain.getDecision("model")!.value).toBe("strong-model");
  });
});

describe("DecisionChain: Trace summary", () => {
  it("toTraceSummary returns all decisions and violations", () => {
    const chain = createDecisionChain();
    chain.record("cat", "A", "model_heuristic", "cls", "classified");
    chain.record("cat", "B", "compliance_policy", "gate", "override");
    chain.record("cat", "C", "fallback", "fb", "try blocked");

    const summary = chain.toTraceSummary();
    expect(summary.decisions.length).toBe(2); // A and B (C was blocked)
    expect(summary.violations.length).toBe(1);
    expect(summary.violations[0].attempted).toBe("fallback");
    expect(summary.violations[0].blocked_by).toBe("compliance_policy");
  });
});

// ===========================================================================
// Preflight Check Tests
// ===========================================================================

describe("Preflight: Valid workflow", () => {
  it("passes for default chat workflow", () => {
    const graph = {
      entry: "classify",
      nodes: {
        classify: {
          type: "classifier",
          agent: "classify",
          transitions: { __default__: "specialist", Else: "main_agent" },
        },
        specialist: {
          type: "agent",
          agent: "__from_category__",
          next: "main_agent",
        },
        main_agent: {
          type: "agent",
          agent: "main_agent",
          next: "simplicity",
        },
        simplicity: {
          type: "agent",
          agent: "simplicity",
          next: null,
        },
      },
    };
    const result = preflightCheckWorkflow(graph, ["classify", "main_agent", "simplicity"], []);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});

describe("Preflight: Missing entry node", () => {
  it("reports error when entry node does not exist", () => {
    const graph = {
      entry: "nonexistent",
      nodes: { a: { type: "agent", next: null } },
    };
    const result = preflightCheckWorkflow(graph, [], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });
});

describe("Preflight: Broken transitions", () => {
  it("reports error for classifier with missing transition target", () => {
    const graph = {
      entry: "cls",
      nodes: {
        cls: { type: "classifier", transitions: { A: "does_not_exist" } },
      },
    };
    const result = preflightCheckWorkflow(graph, [], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("does_not_exist"))).toBe(true);
  });

  it("reports error for classifier with no transitions", () => {
    const graph = {
      entry: "cls",
      nodes: { cls: { type: "classifier" } },
    };
    const result = preflightCheckWorkflow(graph, [], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no transitions"))).toBe(true);
  });
});

describe("Preflight: Orphan nodes", () => {
  it("warns about unreachable nodes", () => {
    const graph = {
      entry: "a",
      nodes: {
        a: { type: "agent", next: null },
        orphan: { type: "agent", next: null },
      },
    };
    const result = preflightCheckWorkflow(graph, [], []);
    expect(result.valid).toBe(true); // Orphans are warnings, not errors
    expect(result.warnings.some((w) => w.includes("orphan"))).toBe(true);
  });
});

describe("Preflight: Missing agent configs", () => {
  it("warns when agent node references unknown agent", () => {
    const graph = {
      entry: "a",
      nodes: { a: { type: "agent", agent: "nonexistent_agent", next: null } },
    };
    const result = preflightCheckWorkflow(graph, ["main_agent"], []);
    expect(result.warnings.some((w) => w.includes("nonexistent_agent"))).toBe(true);
  });

  it("does not warn for __from_category__ special token", () => {
    const graph = {
      entry: "a",
      nodes: { a: { type: "agent", agent: "__from_category__", next: null } },
    };
    const result = preflightCheckWorkflow(graph, [], []);
    expect(result.warnings.filter((w) => w.includes("__from_category__")).length).toBe(0);
  });
});

describe("Preflight: Critic node validation", () => {
  it("reports error when critic target_node is missing", () => {
    const graph = {
      entry: "c",
      nodes: {
        c: { type: "critic", target_node: "ghost", next: null },
      },
    };
    const result = preflightCheckWorkflow(graph, [], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ghost"))).toBe(true);
  });
});

// ===========================================================================
// Golden Scenario: Override Hierarchy Coverage
// ===========================================================================

describe("Golden Scenario: Full hierarchy test", () => {
  it("ruleset_snapshot cannot be overridden by any weaker source", () => {
    const chain = createDecisionChain();
    chain.record("rule", "pinned_value", "ruleset_snapshot", "rs-123", "snapshot");

    // All weaker sources should fail
    const weaker: DecisionSourceType[] = [
      "compliance_policy",
      "orchestration_policy",
      "knowledge_retrieval",
      "model_heuristic",
      "fallback",
    ];

    for (const weak of weaker) {
      const result = chain.record("rule", "different", weak, "test", "try override");
      expect(result.ok).toBe(false);
    }

    // Original value unchanged
    expect(chain.getDecision("rule")!.value).toBe("pinned_value");
    expect(chain.getViolations().length).toBe(weaker.length);
  });

  it("compliance_policy overrides everything except ruleset_snapshot", () => {
    for (const weaker of ["orchestration_policy", "knowledge_retrieval", "model_heuristic", "fallback"] as DecisionSourceType[]) {
      const chain = createDecisionChain();
      chain.record("test", "weak_value", weaker, "src", "initial");
      const result = chain.record("test", "compliance_value", "compliance_policy", "gate", "compliance");
      expect(result.ok).toBe(true);
    }
  });
});
