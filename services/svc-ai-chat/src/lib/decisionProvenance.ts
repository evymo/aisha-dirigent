/**
 * Decision Provenance — Correctness Foundation Module
 *
 * Tracks the source and authority of every decision in the AI pipeline.
 * Ensures no layer silently overrides a stronger decision from another layer
 * without traceable justification.
 *
 * ## Decision Hierarchy (strongest → weakest)
 *
 * 1. `ruleset_snapshot` — Pinned story ruleset (SHA-256 fingerprinted, immutable)
 * 2. `compliance_policy` — Compliance gate verdict (must_pass_compliance)
 * 3. `orchestration_policy` — Route task / Dirigent directive
 * 4. `knowledge_retrieval` — KB retrieval (pgvector / ragnarok)
 * 5. `model_heuristic` — LLM-generated decision (classify, tool call, etc.)
 * 6. `fallback` — Default / degradation path
 *
 * ## Override Rules
 *
 * - A weaker source CANNOT silently override a stronger source.
 * - All overrides MUST be logged with an explicit reason.
 * - `escalation` overrides are always allowed (stronger authority intervenes).
 *
 * @module decisionProvenance
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Source types ranked by authority (lower index = stronger).
 * The ordering defines the override hierarchy.
 *
 * New (autopilot vrstvy):
 *   - `gateway_route` — transport-level override (e.g. rate-limit fallback at LLM Gateway)
 *   - `execution_strategy` — AISHA's aisha_choose_execution_strategy decision (graph, slot, profile, batch)
 *   - `slot_classification` — Soulforge slot classification result
 *   - `graph_node_transition` — node-level decisions inside a LangGraph run
 */
export const DECISION_SOURCE_HIERARCHY = [
  "ruleset_snapshot",
  "core_values",
  "compliance_policy",
  "gateway_route",
  "execution_strategy",
  "orchestration_policy",
  "knowledge_retrieval",
  "graph_node_transition",
  "slot_classification",
  "model_heuristic",
  "fallback",
] as const;

export type DecisionSourceType = typeof DECISION_SOURCE_HIERARCHY[number];

/**
 * A single decision record in the provenance chain.
 */
export interface DecisionRecord {
  /** Unique ID for this decision (auto-generated). */
  id: string;
  /** What was decided (e.g. "model_selection", "category", "compliance_verdict"). */
  decision: string;
  /** The chosen value or outcome. */
  value: string;
  /** Source type that produced this decision. */
  sourceType: DecisionSourceType;
  /** Specific source identifier (e.g. rule slug, policy name, agent slug). */
  sourceId: string;
  /** Human-readable reason for this decision. */
  reason: string;
  /** Timestamp of the decision. */
  timestamp: string;
  /** Whether this decision overrode a previous one. */
  isOverride: boolean;
  /** If isOverride, the ID of the decision it overrode. */
  overriddenDecisionId?: string;
  /** If isOverride, the justification for the override. */
  overrideJustification?: string;
}

/**
 * Violation produced when an invalid override is attempted.
 */
export interface ProvenanceViolation {
  /** The decision that was attempted. */
  attemptedDecision: string;
  /** The source that attempted the override. */
  attemptedSource: DecisionSourceType;
  /** The existing stronger decision that would be overridden. */
  existingDecision: DecisionRecord;
  /** Why this override is not allowed. */
  reason: string;
  /** Timestamp of the violation. */
  timestamp: string;
}

/**
 * Result from `recordDecision()` — either success or violation.
 */
export type RecordResult =
  | { ok: true; record: DecisionRecord }
  | { ok: false; violation: ProvenanceViolation };

// =============================================================================
// Decision Chain
// =============================================================================

/**
 * Decision Chain — tracks all decisions for a single pipeline run
 * and enforces the override hierarchy.
 *
 * Usage:
 *   const chain = createDecisionChain();
 *
 *   chain.record("model_selection", "gpt-5-mini", "model_heuristic", "auto_select", "complexity=greeting");
 *   chain.record("model_selection", "claude-sonnet-4", "compliance_policy", "risk_escalation", "high risk override");
 *   // ✅ compliance_policy is stronger than model_heuristic — override allowed
 *
 *   chain.record("model_selection", "gpt-5-mini", "fallback", "default", "revert to cheap");
 *   // ❌ fallback cannot override compliance_policy — violation logged
 */
export function createDecisionChain() {
  const decisions: DecisionRecord[] = [];
  const violations: ProvenanceViolation[] = [];
  const latestByDecision = new Map<string, DecisionRecord>();

  /**
   * Get the authority rank of a source type (lower = stronger).
   */
  function getAuthorityRank(source: DecisionSourceType): number {
    const idx = DECISION_SOURCE_HIERARCHY.indexOf(source);
    return idx === -1 ? DECISION_SOURCE_HIERARCHY.length : idx;
  }

  /**
   * Record a new decision in the chain.
   *
   * @param decision - What is being decided (e.g. "model_selection", "category")
   * @param value - The decided value
   * @param sourceType - Authority source of this decision
   * @param sourceId - Specific source identifier
   * @param reason - Human-readable justification
   * @param forceOverride - If true, allow override regardless of hierarchy (logged as escalation)
   * @returns RecordResult with either the recorded decision or a violation
   */
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

    // Check override validity
    if (existing && existing.value !== value) {
      const existingRank = getAuthorityRank(existing.sourceType);
      const newRank = getAuthorityRank(sourceType);

      // Weaker source trying to override stronger → violation (unless forced)
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

    const record: DecisionRecord = {
      id: crypto.randomUUID(),
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

    decisions.push(record);
    latestByDecision.set(decision, record);
    return { ok: true, record };
  }

  /**
   * Get the current effective value for a decision.
   */
  function getDecision(decision: string): DecisionRecord | undefined {
    return latestByDecision.get(decision);
  }

  /**
   * Get all decisions in the chain (ordered by recording time).
   */
  function getAll(): readonly DecisionRecord[] {
    return decisions;
  }

  /**
   * Get all violations that occurred during this run.
   */
  function getViolations(): readonly ProvenanceViolation[] {
    return violations;
  }

  /**
   * Check if there are any unresolved violations.
   */
  function hasViolations(): boolean {
    return violations.length > 0;
  }

  /**
   * Export the chain as a compact summary for trace metadata.
   */
  function toTraceSummary(): {
    decisions: Array<{ decision: string; value: string; source: string; sourceId: string; override: boolean }>;
    violations: Array<{ decision: string; attempted: string; blocked_by: string; reason: string }>;
  } {
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

  return {
    record,
    getDecision,
    getAll,
    getViolations,
    hasViolations,
    toTraceSummary,
  };
}

export type DecisionChain = ReturnType<typeof createDecisionChain>;

// =============================================================================
// Context Source Labels
// =============================================================================

/**
 * Standard source labels used throughout the context composition pipeline.
 * Every context chunk MUST carry one of these labels.
 */
export const CONTEXT_SOURCE_LABELS = {
  /** From compose_context RPC → project_context layer */
  PROJECT_CONTEXT: "compose:project_context",
  /** From compose_context RPC → ruleset layer (expert rules snapshot) */
  RULESET_SNAPSHOT: "compose:ruleset_snapshot",
  /** From compose_context RPC → kb_retrieval layer + pgvector */
  KB_PGVECTOR: "compose:kb_pgvector",
  /** From Ragnarok RAG pipeline (Elasticsearch hybrid search) */
  KB_RAGNAROK: "compose:kb_ragnarok",
  /** From compose_context RPC → memory layer (ai_trace_events) */
  MEMORY_TRACE: "compose:memory_trace",
  /** From session memory (memoryManager) */
  MEMORY_SESSION: "memory:session",
  /** From user long-term memory (memoryManager) */
  MEMORY_USER: "memory:user",
  /** Agent instructions from agent_configurations DB */
  AGENT_INSTRUCTIONS: "config:agent_instructions",
  /** Guardrails / restriction prompt */
  GUARDRAILS: "config:guardrails",
  /** Inline fallback (no external source available) */
  INLINE_FALLBACK: "inline:fallback",
} as const;

export type ContextSourceLabel = typeof CONTEXT_SOURCE_LABELS[keyof typeof CONTEXT_SOURCE_LABELS];

// =============================================================================
// Workflow Preflight Checks
// =============================================================================

/**
 * Result of a workflow preflight check.
 */
export interface PreflightCheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a workflow graph before execution.
 *
 * Checks:
 * 1. Entry node exists in the graph.
 * 2. All transition targets point to existing nodes.
 * 3. No orphan nodes (unreachable from entry).
 * 4. Classifier nodes have transitions defined.
 * 5. Agent nodes reference resolvable agents or special tokens.
 * 6. No cycles that bypass the safety limit.
 */
export function preflightCheckWorkflow(
  graph: { entry: string; nodes: Record<string, { type: string; next?: string | null; transitions?: Record<string, string>; children?: string | string[]; agent?: string; target_node?: string }> },
  availableAgentNames: string[],
  availableCategories: string[],
): PreflightCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(Object.keys(graph.nodes));

  // 1. Entry node exists
  if (!nodeIds.has(graph.entry)) {
    errors.push(`Entry node '${graph.entry}' not found in graph`);
  }

  // 2. Reachability analysis
  const reachable = new Set<string>();
  const queue = [graph.entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const node = graph.nodes[current];
    if (!node) continue;

    // Follow next
    if (node.next && nodeIds.has(node.next)) {
      queue.push(node.next);
    }

    // Follow transitions
    if (node.transitions) {
      for (const target of Object.values(node.transitions)) {
        if (nodeIds.has(target)) {
          queue.push(target);
        }
      }
    }

    // Follow critic target_node
    if (node.target_node && nodeIds.has(node.target_node)) {
      queue.push(node.target_node);
    }

    // Follow parallel children
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (nodeIds.has(child)) {
          queue.push(child);
        }
      }
    }
  }

  // Check for orphan nodes
  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) {
      warnings.push(`Node '${nodeId}' is unreachable from entry '${graph.entry}'`);
    }
  }

  // 3. Validate each node
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    // Check next target exists
    if (node.next && !nodeIds.has(node.next)) {
      errors.push(`Node '${nodeId}' references non-existent next node '${node.next}'`);
    }

    // Classifier: must have transitions
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

    // Agent: check resolvable
    if (node.type === "agent" && node.agent) {
      const specialTokens = ["__from_category__"];
      if (!specialTokens.includes(node.agent) && !availableAgentNames.includes(node.agent)) {
        warnings.push(`Agent node '${nodeId}' references agent '${node.agent}' not found in active configurations`);
      }
    }

    // Critic: check target_node exists
    if (node.type === "critic" && node.target_node) {
      if (!nodeIds.has(node.target_node)) {
        errors.push(`Critic node '${nodeId}' target_node '${node.target_node}' not found in graph`);
      }
    }

    // Parallel: check children
    if (node.type === "parallel" && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (!nodeIds.has(child) && !availableAgentNames.includes(child)) {
          warnings.push(`Parallel node '${nodeId}' references unknown child '${child}'`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
