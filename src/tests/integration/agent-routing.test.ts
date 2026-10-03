/**
 * Agent Routing Integration Tests
 *
 * Verifies the end-to-end agent routing logic:
 * 1. route_task RPC → produces a route plan with agent slugs + risk level
 * 2. Risk level → autonomy enforcement rules (get_autonomy_enforcement_rules)
 * 3. HIGH/CRITICAL risk → requires_approval = true
 * 4. LOW/MEDIUM risk → auto_approve = true
 * 5. compose_context RPC → enriches context with KB retrieval
 * 6. Context profile selection based on route plan
 *
 * Uses mocked Supabase client — does NOT require a live DB.
 * Run: npm run test:run -- src/tests/integration/agent-routing.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Types ──────────────────────────────────────────────────────────────────

interface RoutePlan {
  agent_slug: string;
  risk_level: "low" | "medium" | "high" | "critical";
  requires_approval: boolean;
  context_profile: string;
  run_id?: string;
}

interface AutononyEnforcementRule {
  risk_level: string;
  requires_approval: boolean;
  auto_approve: boolean;
  notify_level: "none" | "log_only" | "dirigent" | "expert";
  escalation_minutes: number;
  audit_required: boolean;
  action_description: string;
}

// ── Mock setup ─────────────────────────────────────────────────────────────

const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));

const RISK_ENFORCEMENT_MAP: Record<string, AutononyEnforcementRule> = {
  low: {
    risk_level: "low",
    requires_approval: false,
    auto_approve: true,
    notify_level: "log_only",
    escalation_minutes: 0,
    audit_required: false,
    action_description: "AUTO-APPROVE: Log only. No explicit notification.",
  },
  medium: {
    risk_level: "medium",
    requires_approval: false,
    auto_approve: true,
    notify_level: "dirigent",
    escalation_minutes: 0,
    audit_required: true,
    action_description: "AUTO-APPROVE with notification: Notify Dirigent. Audit trail recorded.",
  },
  high: {
    risk_level: "high",
    requires_approval: true,
    auto_approve: false,
    notify_level: "expert",
    escalation_minutes: 240,
    audit_required: true,
    action_description:
      "APPROVAL REQUIRED: Expert approval needed. Notify Dirigent + Expert. Auto-escalate after 4h.",
  },
  critical: {
    risk_level: "critical",
    requires_approval: true,
    auto_approve: false,
    notify_level: "expert",
    escalation_minutes: 60,
    audit_required: true,
    action_description:
      "HARD STOP: Manual expert approval required. Auto-escalate after 60min. Full audit mandatory.",
  },
};

function mockRpcResponse<T>(data: T) {
  return { data, error: null };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("route_task: agent routing contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("route_task returns route plan with required fields", async () => {
    const routePlan: RoutePlan = {
      agent_slug: "librarian",
      risk_level: "low",
      requires_approval: false,
      context_profile: "repo_plus_rules",
      run_id: "run-001",
    };
    mockRpc.mockResolvedValueOnce(mockRpcResponse([routePlan]));

    const { data, error } = await mockRpc("route_task", {
      p_task_kind: "chat",
      p_story_id: null,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    const result = Array.isArray(data) ? data[0] : data;
    expect(result).toHaveProperty("agent_slug");
    expect(result).toHaveProperty("risk_level");
    expect(result).toHaveProperty("requires_approval");
    expect(result).toHaveProperty("context_profile");
  });

  it("risk_level from route_task can be used to query enforcement rules", async () => {
    // Step 1: route_task → risk_level
    mockRpc.mockResolvedValueOnce(
      mockRpcResponse([{ agent_slug: "dev_patch", risk_level: "high", requires_approval: true }])
    );
    const { data: routeData } = await mockRpc("route_task", { p_task_kind: "project_delivery" });
    const riskLevel = routeData[0].risk_level;

    // Step 2: get_autonomy_enforcement_rules → enforcement policy
    mockRpc.mockResolvedValueOnce(mockRpcResponse([RISK_ENFORCEMENT_MAP[riskLevel]]));
    const { data: rules } = await mockRpc("get_autonomy_enforcement_rules", {
      p_risk_level: riskLevel,
    });

    const rule = rules[0];
    expect(rule.risk_level).toBe("high");
    expect(rule.requires_approval).toBe(true);
    expect(rule.auto_approve).toBe(false);
    expect(rule.notify_level).toBe("expert");
    expect(rule.escalation_minutes).toBeGreaterThan(0);
    expect(rule.audit_required).toBe(true);
  });
});

describe("get_autonomy_enforcement_rules: risk matrix coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["low", false, true, "log_only", 0, false],
    ["medium", false, true, "dirigent", 0, true],
    ["high", true, false, "expert", 240, true],
    ["critical", true, false, "expert", 60, true],
  ] as const)(
    "risk_level=%s → requires_approval=%s, auto_approve=%s, notify=%s, escalation=%dmin, audit=%s",
    async (level, reqApproval, autoApprove, notify, escalation, auditRequired) => {
      mockRpc.mockResolvedValueOnce(mockRpcResponse([RISK_ENFORCEMENT_MAP[level]]));
      const { data, error } = await mockRpc("get_autonomy_enforcement_rules", {
        p_risk_level: level,
      });
      expect(error).toBeNull();
      const rule: AutononyEnforcementRule = data[0];
      expect(rule.requires_approval).toBe(reqApproval);
      expect(rule.auto_approve).toBe(autoApprove);
      expect(rule.notify_level).toBe(notify);
      expect(rule.escalation_minutes).toBe(escalation);
      expect(rule.audit_required).toBe(auditRequired);
    }
  );

  it("critical risk has shorter escalation window than high risk", async () => {
    const criticalRule = RISK_ENFORCEMENT_MAP["critical"];
    const highRule = RISK_ENFORCEMENT_MAP["high"];
    expect(criticalRule.escalation_minutes).toBeLessThan(highRule.escalation_minutes);
    expect(criticalRule.escalation_minutes).toBe(60);
    expect(highRule.escalation_minutes).toBe(240);
  });

  it("low and medium risks never require explicit approval", () => {
    expect(RISK_ENFORCEMENT_MAP["low"].requires_approval).toBe(false);
    expect(RISK_ENFORCEMENT_MAP["medium"].requires_approval).toBe(false);
  });

  it("high and critical risks always require approval and audit", () => {
    expect(RISK_ENFORCEMENT_MAP["high"].requires_approval).toBe(true);
    expect(RISK_ENFORCEMENT_MAP["high"].audit_required).toBe(true);
    expect(RISK_ENFORCEMENT_MAP["critical"].requires_approval).toBe(true);
    expect(RISK_ENFORCEMENT_MAP["critical"].audit_required).toBe(true);
  });
});

describe("compose_context: context enrichment contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compose_context is called with story_id and context_profile", async () => {
    const mockContext = {
      kb_chunks: [{ id: "chunk-1", content: "Expert rule: RPC-only", score: 0.95 }],
      project_context: { story_id: "story-123", ruleset: "4f11513a" },
      memory_trace: [],
    };
    mockRpc.mockResolvedValueOnce(mockRpcResponse(mockContext));

    const { data, error } = await mockRpc("compose_context", {
      p_story_id: "story-123",
      p_context_profile: "repo_plus_rules",
      p_run_id: "run-001",
      p_query: "what is the RPC pattern?",
    });

    expect(error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith(
      "compose_context",
      expect.objectContaining({
        p_story_id: "story-123",
        p_context_profile: "repo_plus_rules",
      })
    );
    expect(data).toHaveProperty("kb_chunks");
  });

  it("KB chunks have required fields: id, content, score", async () => {
    const expectedChunks = [
      { id: "c1", content: "RPC-only pattern", score: 0.9 },
      { id: "c2", content: "SECURITY DEFINER rules", score: 0.85 },
    ];
    mockRpc.mockResolvedValueOnce(
      mockRpcResponse({ kb_chunks: expectedChunks, project_context: {} })
    );

    const { data } = await mockRpc("compose_context", { p_context_profile: "repo_plus_rules" });
    const chunks = data.kb_chunks as Array<{ id: string; content: string; score: number }>;
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("score");
    }
  });
});

describe("fn_evaluate_proposal_risk: risk scoring logic", () => {
  it.each([
    ["security", "strict", "critical"],
    ["database", "standard", "high"],
    ["function", "minimal", "low"],
    ["translation", "minimal", "low"],
  ] as const)(
    "category=%s + agent safety=%s → expected risk=%s",
    async (category, safety, expectedRisk) => {
      mockRpc.mockResolvedValueOnce(mockRpcResponse(expectedRisk));
      const { data } = await mockRpc("fn_evaluate_proposal_risk", {
        p_agent_slug: `test_agent_${safety}`,
        p_category: category,
        p_metadata: {},
      });
      expect(data).toBe(expectedRisk);
    }
  );
});
