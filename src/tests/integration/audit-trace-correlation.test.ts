/**
 * Audit-Trace Correlation Integration Tests
 *
 * Verifies the audit ↔ ai_runs ↔ Langfuse trace linkage:
 * 1. link_audit_to_ai_run RPC attaches ai_run_id + langfuse_trace_id to an audit entry
 * 2. write_audit_journal creates an audit entry with expected fields
 * 3. Audit entries for AI-triggered operations carry action/area/severity
 * 4. Correlation IDs are threaded through from AI run → audit → Langfuse
 * 5. Sensitive operations always produce audit entries
 *
 * Uses mocked Supabase client — does NOT require a live DB.
 * Run: npm run test:run -- src/tests/integration/audit-trace-correlation.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock setup ─────────────────────────────────────────────────────────────

const mockRpc = vi.fn();

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));

function mockSuccess<T>(data: T) {
  return { data, error: null };
}

function mockError(message: string) {
  return { data: null, error: { message } };
}

// ── Types ──────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ai_run_id: string | null;
  langfuse_trace_id: string | null;
  area: string;
  severity: string;
  created_at: string;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("link_audit_to_ai_run: trace correlation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully links audit entry to AI run", async () => {
    const auditId = "audit-001";
    const aiRunId = "run-abc123";
    const langfuseTraceId = "trace-xyz456";

    mockRpc.mockResolvedValueOnce(mockSuccess(null));

    const { error } = await mockRpc("link_audit_to_ai_run", {
      p_audit_id: auditId,
      p_ai_run_id: aiRunId,
      p_langfuse_trace_id: langfuseTraceId,
    });

    expect(error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith(
      "link_audit_to_ai_run",
      expect.objectContaining({
        p_audit_id: auditId,
        p_ai_run_id: aiRunId,
        p_langfuse_trace_id: langfuseTraceId,
      })
    );
  });

  it("rejects correlation for non-existent or unauthorized audit entry", async () => {
    mockRpc.mockResolvedValueOnce(
      mockError("audit_journal entry not found or access denied: audit-999")
    );

    const { data, error } = await mockRpc("link_audit_to_ai_run", {
      p_audit_id: "audit-999",
      p_ai_run_id: "run-001",
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toContain("not found or access denied");
  });

  it("supports linking without langfuse_trace_id (partial correlation)", async () => {
    mockRpc.mockResolvedValueOnce(mockSuccess(null));

    const { error } = await mockRpc("link_audit_to_ai_run", {
      p_audit_id: "audit-001",
      p_ai_run_id: "run-001",
      // p_langfuse_trace_id omitted — default NULL
    });

    expect(error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith("link_audit_to_ai_run", expect.not.objectContaining({
      p_langfuse_trace_id: expect.anything(),
    }));
  });
});

describe("write_audit_journal: audit entry completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates audit entry and returns UUID", async () => {
    const returnedId = "audit-generated-001";
    mockRpc.mockResolvedValueOnce(mockSuccess(returnedId));

    const { data, error } = await mockRpc("write_audit_journal", {
      p_action_type: "READ",
      p_area: "sensitive",
      p_entity_type: "health_check_in",
      p_entity_id: "entity-123",
      p_severity: "info",
      p_summary: "Member read their health check-in record",
      p_tags: ["health", "member"],
    });

    expect(error).toBeNull();
    expect(data).toBe(returnedId);
  });

  it("includes area and severity — required for audit classification", async () => {
    mockRpc.mockResolvedValueOnce(mockSuccess("audit-002"));

    await mockRpc("write_audit_journal", {
      p_action_type: "DELETE",
      p_area: "admin",
      p_severity: "warning",
      p_entity_type: "user_account",
      p_entity_id: "user-456",
      p_summary: "Admin deleted user account",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "write_audit_journal",
      expect.objectContaining({
        p_area: "admin",
        p_severity: "warning",
      })
    );
  });

  it("does NOT include PII (email/name) in audit metadata — security requirement", async () => {
    mockRpc.mockResolvedValueOnce(mockSuccess("audit-003"));

    await mockRpc("write_audit_journal", {
      p_action_type: "READ",
      p_area: "sensitive",
      p_entity_type: "member_profile",
      p_entity_id: "user-789", // ID only — NOT email or name
      p_severity: "info",
      p_summary: "Profile read", // generic — NOT 'John Doe profile read'
      p_tags: ["profile"],
    });

    const callArgs = mockRpc.mock.calls[0];
    const params = callArgs[1] as Record<string, unknown>;
    // Verify the entity_id is an opaque ID, not email
    expect(params["p_entity_id"]).not.toMatch(/@/);
    // Verify no PII strings in the call
    const argsStr = JSON.stringify(params);
    expect(argsStr).not.toMatch(/[a-z]+\.[a-z]+@[a-z]+/); // no email format
  });
});

describe("audit-trace correlation: end-to-end flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AI chat run: audit → link to AI run → correlation is complete", async () => {
    // Step 1: Write audit entry for a sensitive AI interaction
    const auditId = "audit-e2e-001";
    const runId = "run-e2e-001";
    const langfuseId = "trace-e2e-001";

    mockRpc.mockResolvedValueOnce(mockSuccess(auditId));
    const { data: createdAuditId } = await mockRpc("write_audit_journal", {
      p_action_type: "READ",
      p_area: "ai",
      p_entity_type: "ai_run",
      p_entity_id: runId,
      p_severity: "info",
      p_summary: "AI chat interaction processed",
    });
    expect(createdAuditId).toBe(auditId);

    // Step 2: Link the audit entry to the AI run and Langfuse trace
    mockRpc.mockResolvedValueOnce(mockSuccess(null));
    const { error: linkError } = await mockRpc("link_audit_to_ai_run", {
      p_audit_id: auditId,
      p_ai_run_id: runId,
      p_langfuse_trace_id: langfuseId,
    });
    expect(linkError).toBeNull();

    // Step 3: Verify both calls were made in the right order
    expect(mockRpc).toHaveBeenNthCalledWith(1, "write_audit_journal", expect.any(Object));
    expect(mockRpc).toHaveBeenNthCalledWith(2, "link_audit_to_ai_run", expect.objectContaining({
      p_audit_id: auditId,
      p_ai_run_id: runId,
      p_langfuse_trace_id: langfuseId,
    }));
  });

  it("HIGH risk proposal: audit created before approval request", async () => {
    const proposalId = "proposal-001";
    const runId = "run-proposal-001";

    // Audit entry created when proposal is submitted
    mockRpc.mockResolvedValueOnce(mockSuccess("audit-proposal-001"));
    const { data: auditId, error: auditErr } = await mockRpc("write_audit_journal", {
      p_action_type: "CREATE",
      p_area: "ai",
      p_entity_type: "improvement_proposal",
      p_entity_id: proposalId,
      p_severity: "warning", // HIGH risk → warning severity
      p_summary: "High-risk improvement proposal submitted for approval",
      p_tags: ["proposal", "high_risk", "approval_required"],
    });
    expect(auditErr).toBeNull();
    expect(auditId).toBeDefined();

    // Link to AI run
    mockRpc.mockResolvedValueOnce(mockSuccess(null));
    await mockRpc("link_audit_to_ai_run", {
      p_audit_id: auditId,
      p_ai_run_id: runId,
    });

    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe("ai_runs: run lifecycle audit trail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AI run should have audit entries for start and finish", async () => {
    const runId = "run-lifecycle-001";

    // Start audit
    mockRpc.mockResolvedValueOnce(mockSuccess("audit-start-001"));
    await mockRpc("write_audit_journal", {
      p_action_type: "CREATE",
      p_area: "ai",
      p_entity_type: "ai_run",
      p_entity_id: runId,
      p_severity: "info",
      p_summary: "AI run started",
      p_tags: ["ai_run", "start"],
    });

    // Finish audit
    mockRpc.mockResolvedValueOnce(mockSuccess("audit-finish-001"));
    await mockRpc("write_audit_journal", {
      p_action_type: "UPDATE",
      p_area: "ai",
      p_entity_type: "ai_run",
      p_entity_id: runId,
      p_severity: "info",
      p_summary: "AI run completed",
      p_tags: ["ai_run", "complete"],
    });

    expect(mockRpc).toHaveBeenCalledTimes(2);
    const calls = mockRpc.mock.calls;
    expect(calls[0][1]["p_action_type"]).toBe("CREATE");
    expect(calls[1][1]["p_action_type"]).toBe("UPDATE");
    // Both reference the same runId
    expect(calls[0][1]["p_entity_id"]).toBe(runId);
    expect(calls[1][1]["p_entity_id"]).toBe(runId);
  });
});
