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

import { createSafeLogger } from "@aisha/security";

import { rpcService } from "../postgrest.js";
import { config } from "../config.js";
import type { DecisionChain, DecisionSourceType } from "./decisionProvenance.js";

const log = createSafeLogger("governedOrchestration");

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
// Data-sensitivity / on-prem residency gate (§11)
// =============================================================================

/** Residency classification for a request's data. */
export type DataSensitivity = "public" | "internal" | "confidential";

/** Ordered sensitivity rank (public < internal < confidential). */
const SENSITIVITY_RANK: Record<DataSensitivity, number> = { public: 0, internal: 1, confidential: 2 };

/**
 * Whether cloud LLM providers may serve a request of the given sensitivity under the ACTIVE
 * residency mode (config.residencyCloudForbiddenMinSensitivity — the stack runs in one mode per
 * instance). Cloud is allowed only when the data is STRICTLY BELOW the mode's forbidding threshold,
 * so the threshold and everything above it stays on-prem. 'confidential' (default) → only PHI on-prem;
 * 'internal' → internal+confidential on-prem; 'public' → everything local. Derived, never hardcoded.
 */
export function cloudAllowedForSensitivity(
  sensitivity: DataSensitivity,
  policy: DataSensitivity = config.residencyCloudForbiddenMinSensitivity as DataSensitivity,
): boolean {
  const minForbiddenRank = SENSITIVITY_RANK[policy] ?? SENSITIVITY_RANK.confidential;
  return SENSITIVITY_RANK[sensitivity] < minForbiddenRank;
}

/** Verdict of {@link detectDataSensitivity} — the single residency truth. */
export interface DataSensitivityVerdict {
  /** Classified sensitivity. */
  sensitivity: DataSensitivity;
  /** Confidential anchor tables matched (empty unless confidential). */
  tables: string[];
  /**
   * Whether cloud LLM APIs may serve this request. `false` at confidential ⇒
   * the dispatch MUST set `clow.cloud_forbidden=true` so
   * aisha_resolve_clow_backend hard-excludes direct_cloud / llm_gateway.
   */
  canUseCloudApis: boolean;
}

/**
 * Fail-safe baseline of confidential anchor tables (§11/§15). The DB registry
 * `data_sensitivity_registry` (read via get_data_sensitivity_registry) is the
 * SOURCE OF TRUTH — operators extend residency coverage there with no code
 * change. This literal is ONLY the graceful-degradation default: used until the
 * registry is first loaded, and whenever the DB is unreachable or unseeded, so
 * the classifier is NEVER less strict than this baseline. See
 * {@link refreshSensitivityRegistry}.
 */
export const CONFIDENTIAL_ANCHOR_FALLBACK = [
  "member_health_documents",
  "dosing_logs",
  "longevity_scores",
] as const;

interface SensitivityCache {
  /** Lower-cased confidential anchor table names. */
  confidential: Set<string>;
  lastLoaded: number;
  source: "fallback" | "database";
}

let sensitivityCache: SensitivityCache = {
  confidential: new Set(CONFIDENTIAL_ANCHOR_FALLBACK),
  lastLoaded: 0,
  source: "fallback",
};

let sensitivityRefreshInFlight: Promise<void> | null = null;

interface DataSensitivityRow {
  table_name: string;
  sensitivity: string;
}

/**
 * Refresh the cached confidential-anchor set from the DB registry
 * (get_data_sensitivity_registry). Fail-safe: on ANY error OR an empty result
 * the previous cache (≥ the built-in fallback) is kept — a registry outage or a
 * not-yet-seeded DB can never silently make the classifier permissive. A
 * NON-EMPTY registry is authoritative (operators fully control the list, incl.
 * removing a baseline anchor). Mirrors the delivery-status flag cache below.
 */
export async function refreshSensitivityRegistry(): Promise<void> {
  try {
    const rows = await rpcService<DataSensitivityRow[]>("get_data_sensitivity_registry", {});
    if (!Array.isArray(rows)) {
      log.safeError(
        "[§11] get_data_sensitivity_registry returned non-array; keeping previous cache",
        { received: typeof rows },
      );
      return;
    }
    const confidential = new Set<string>();
    for (const r of rows) {
      if (r?.sensitivity === "confidential" && typeof r.table_name === "string") {
        confidential.add(r.table_name.toLowerCase());
      }
    }
    if (confidential.size === 0) {
      // Empty / unseeded registry → keep the fail-safe fallback; retry next tick
      // (NOT updating lastLoaded). Never go permissive on a blank registry.
      return;
    }
    sensitivityCache = { confidential, lastLoaded: Date.now(), source: "database" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.safeError(
      "[§11] Failed to refresh data_sensitivity_registry; keeping previous cache",
      message,
    );
    // Intentionally NOT updating lastLoaded — next call will retry sooner.
  }
}

/**
 * Background-refresh the sensitivity cache when stale. Returns immediately; the
 * current caller still sees whatever is in `sensitivityCache` (fallback or the
 * last successful DB snapshot) — the hot path is NEVER blocked on the DB.
 */
function maybeRefreshSensitivity(): void {
  if (sensitivityRefreshInFlight) return;
  const stale = Date.now() - sensitivityCache.lastLoaded > config.omniSensitivityRegistryTtlMs;
  if (!stale) return;
  sensitivityRefreshInFlight = refreshSensitivityRegistry().finally(() => {
    sensitivityRefreshInFlight = null;
  });
}

/** Current confidential-anchor set (cache read — triggers a non-blocking refresh if stale). */
function confidentialAnchors(): ReadonlySet<string> {
  maybeRefreshSensitivity();
  return sensitivityCache.confidential;
}

/**
 * Classify a request's data sensitivity (§11). Fast (NO hot-path DB / RLS joins):
 * matches the message content + RAG provenance tables against the cached
 * confidential anchor set (DB-driven, fail-safe fallback). A confidential verdict
 * forces on-prem residency (canUseCloudApis=false). This is the SINGLE verdict
 * shared by BOTH the Omni /v1 path AND the warm evaluator (evaluate.ts) so
 * residency can never fork between surfaces. Pure + synchronous — callers audit
 * the verdict via {@link auditResidencyVerdict}.
 */
export function detectDataSensitivity(
  messages: ReadonlyArray<{ role: string; content: string }>,
  ragContext: { tables?: string[]; provenance?: unknown } | null,
): DataSensitivityVerdict {
  const anchors = confidentialAnchors();
  const matched = new Set<string>();

  // RAG provenance tables are the strongest, most precise signal.
  for (const t of ragContext?.tables ?? []) {
    const low = String(t).toLowerCase();
    for (const anchor of anchors) {
      if (low.includes(anchor)) matched.add(anchor);
    }
  }
  // Table names leaking into the prompt content (provenance echoes).
  const haystack = messages
    .map((m) => m.content ?? "")
    .join("\n")
    .toLowerCase();
  for (const anchor of anchors) {
    if (haystack.includes(anchor)) matched.add(anchor);
  }

  if (matched.size > 0) {
    return { sensitivity: "confidential", tables: [...matched], canUseCloudApis: cloudAllowedForSensitivity("confidential") };
  }

  // Internal markers — non-confidential business context, cloud still permitted
  // but flagged for audit. Heuristic only (LIVE confidential guard is the gate).
  const internal = /\b(internal[\s_-]|partner_stories|account_)\b/.test(haystack);
  return internal
    ? { sensitivity: "internal", tables: [], canUseCloudApis: cloudAllowedForSensitivity("internal") }
    : { sensitivity: "public", tables: [], canUseCloudApis: cloudAllowedForSensitivity("public") };
}

/**
 * Fire-and-forget audit of a residency verdict to audit_journal (§11 DoD #5).
 * Only CONFIDENTIAL verdicts (where on-prem residency is ENFORCED) are recorded —
 * that is the governance-relevant event. Never throws / never blocks the turn.
 */
export function auditResidencyVerdict(
  verdict: DataSensitivityVerdict,
  ctx: { userId?: string | null; aiRunId?: string | null; surface: string },
): void {
  if (verdict.sensitivity !== "confidential") return;
  void rpcService("record_residency_audit", {
    p_ai_run_id: ctx.aiRunId ?? null,
    p_sensitivity: verdict.sensitivity,
    p_surface: ctx.surface,
    p_tables: verdict.tables,
    p_user_id: ctx.userId ?? null,
  }).catch((err) => {
    log.safeWarn("[§11] residency audit write failed (non-blocking)", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Test-only: reset the sensitivity cache to fallback + clear any in-flight refresh. */
export function _resetSensitivityCache(): void {
  sensitivityCache = {
    confidential: new Set(CONFIDENTIAL_ANCHOR_FALLBACK),
    lastLoaded: 0,
    source: "fallback",
  };
  sensitivityRefreshInFlight = null;
}

/** Test-only / diagnostic: surface the current sensitivity cache state. */
export function _getSensitivityCache(): { confidential: string[]; source: string; lastLoaded: number } {
  return {
    confidential: [...sensitivityCache.confidential],
    source: sensitivityCache.source,
    lastLoaded: sensitivityCache.lastLoaded,
  };
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
// Delivery Status Policy Cache
// =============================================================================
//
// Per-status governance flags (requires_approval, restricts_actions) live in
// the `delivery_statuses` table (SoT: aisha/db/sql/tables/delivery_statuses.sql).
// We cache them at the module level with a 5-minute TTL so the synchronous
// resolveApprovalBoundary / evaluateStopConditions paths stay sync.
//
// The hardcoded FALLBACK_FLAGS mirror the original values that lived here
// before commit (PR adding delivery_statuses) — they serve as resilience
// during the brief window between service start and the first successful DB
// load, or while the DB is briefly unavailable. The DB is the source of
// truth; operators tighten or extend flags by editing delivery_statuses,
// not by editing this file.

interface DeliveryStatusFlagSet {
  approvalRequired: Set<string>;
  restrictedActions: Set<string>;
  lastLoaded: number;
  source: "fallback" | "database";
}

/**
 * Conservative fallback used until the first successful DB load. Matches the
 * pre-refactor hardcoded Sets so behavior is bit-identical when the DB is
 * briefly unreachable.
 */
const FALLBACK_FLAGS: Readonly<DeliveryStatusFlagSet> = {
  approvalRequired: new Set(["delivering", "delivered", "archived"]),
  restrictedActions: new Set(["qa", "delivering", "delivered"]),
  lastLoaded: 0,
  source: "fallback",
};

const FLAGS_TTL_MS = 5 * 60 * 1000;

let cachedFlags: DeliveryStatusFlagSet = {
  approvalRequired: new Set(FALLBACK_FLAGS.approvalRequired),
  restrictedActions: new Set(FALLBACK_FLAGS.restrictedActions),
  lastLoaded: 0,
  source: "fallback",
};

let refreshInFlight: Promise<void> | null = null;

interface DeliveryStatusRow {
  status: string;
  requires_approval: boolean;
  restricts_actions: boolean;
}

async function refreshDeliveryStatusFlags(): Promise<void> {
  try {
    const rows = await rpcService<DeliveryStatusRow[]>(
      "list_delivery_statuses",
      { p_include_inactive: false },
    );
    if (!Array.isArray(rows)) {
      log.safeError(
        "[governedOrchestration] list_delivery_statuses returned non-array; keeping previous cache",
        { received: typeof rows },
      );
      return;
    }
    cachedFlags = {
      approvalRequired: new Set(
        rows.filter((r) => r.requires_approval).map((r) => r.status),
      ),
      restrictedActions: new Set(
        rows.filter((r) => r.restricts_actions).map((r) => r.status),
      ),
      lastLoaded: Date.now(),
      source: "database",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.safeError(
      "[governedOrchestration] Failed to refresh delivery_statuses; keeping previous cache",
      message,
    );
    // Intentionally NOT updating lastLoaded — next call will retry sooner.
  }
}

/**
 * Trigger a background refresh of the cached flags when the cache is stale.
 * Returns immediately; the current call still sees whatever values are in
 * `cachedFlags` (fallback or last successful DB snapshot).
 */
function maybeRefreshFlags(): void {
  if (refreshInFlight) return;
  const stale = Date.now() - cachedFlags.lastLoaded > FLAGS_TTL_MS;
  if (!stale) return;
  refreshInFlight = refreshDeliveryStatusFlags().finally(() => {
    refreshInFlight = null;
  });
}

function getApprovalRequiredStatuses(): Set<string> {
  maybeRefreshFlags();
  return cachedFlags.approvalRequired;
}

function getRestrictedActionStatuses(): Set<string> {
  maybeRefreshFlags();
  return cachedFlags.restrictedActions;
}

/**
 * Test-only: reset the cache to fallback and clear any in-flight refresh.
 * Allows unit tests to inject DB responses deterministically.
 */
export function _resetDeliveryStatusFlagsCache(): void {
  cachedFlags = {
    approvalRequired: new Set(FALLBACK_FLAGS.approvalRequired),
    restrictedActions: new Set(FALLBACK_FLAGS.restrictedActions),
    lastLoaded: 0,
    source: "fallback",
  };
  refreshInFlight = null;
}

/**
 * Test-only / diagnostic accessor: surfaces the current cache state.
 */
export function _getDeliveryStatusFlagsCache(): Readonly<DeliveryStatusFlagSet> {
  return {
    approvalRequired: new Set(cachedFlags.approvalRequired),
    restrictedActions: new Set(cachedFlags.restrictedActions),
    lastLoaded: cachedFlags.lastLoaded,
    source: cachedFlags.source,
  };
}

// =============================================================================
// Approval Boundaries
// =============================================================================

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

  // 3. Delivery state-based approval (DB-driven via delivery_statuses lookup;
  // see module-level cache + FALLBACK_FLAGS for resilience semantics).
  if (deliveryState?.currentStatus && getApprovalRequiredStatuses().has(deliveryState.currentStatus)) {
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

  // 3. Restricted delivery state (DB-driven via delivery_statuses lookup;
  // see module-level cache + FALLBACK_FLAGS for resilience semantics).
  if (deliveryState?.currentStatus && getRestrictedActionStatuses().has(deliveryState.currentStatus)) {
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
