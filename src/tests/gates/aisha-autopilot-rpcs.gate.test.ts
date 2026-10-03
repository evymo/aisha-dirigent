/**
 * AISHA Autopilot RPCs Gate Test
 *
 * Validates that every RPC introduced in Phase 1-5 (the autopilot stack) follows
 * AISHA's SECURITY DEFINER + REVOKE/GRANT contract and that admin-gated RPCs
 * write to audit_journal.
 *
 * Why this gate: these RPCs are the brain of AISHA — if any one of them lacks
 * proper auth or audit, the autopilot decision graph could leak sensitive data
 * (story_id, model selection, batch payloads) to anon callers or skip audit.
 *
 * Covers Phase 1-5 SoT files:
 *   - Phase 1: Hippocampus 3 RPCs + execution strategy 3 RPCs
 *   - Phase 2A: Soulforge 3 RPCs
 *   - Phase 2B: OpenClaw 3 advisory RPCs
 *   - Phase 2C: cosmos fn_anchor_decision
 *   - Phase 2D: batch 3 RPCs
 *   - Phase 4A: fn_advise_session_router
 *   - Phase 5: 5 provider/MCP RPCs (resolve_clow_backend, evaluate_provider_for_task,
 *     register/test/record_mcp_test_result)
 *
 * Contract per RPC:
 *   1. SECURITY DEFINER present
 *   2. SET search_path TO 'public' present
 *   3. REVOKE ALL FROM PUBLIC present
 *   4. GRANT EXECUTE TO authenticated AND service_role present
 *   5. Admin-gated RPCs (those with is_admin_or_staff() check) write to audit_journal
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SQL_FUNCTIONS_DIR = path.join(ROOT, "aisha/db/sql/functions");

// Autopilot RPC SoT files introduced in Phase 1-5 (relative to functions dir)
const AUTOPILOT_RPC_FILES = [
  // Phase 1 — Hippocampus + execution strategy
  "fn_capture_learning.sql",
  "fn_search_learnings.sql",
  "fn_maybe_promote_learning.sql",
  "aisha_choose_execution_strategy.sql",
  "fn_create_workflow_run.sql",
  "fn_get_next_graph_node.sql",
  // Phase 2A — Soulforge
  "recommend_slot_for_task.sql",
  "get_slot_routing_table.sql",
  "set_slot_model_mapping.sql",
  // Phase 2B — OpenClaw advisory
  "aisha_request_plan_from_openclaw.sql",
  "aisha_dryrun_in_openclaw_sandbox.sql",
  "aisha_notify_via_openclaw.sql",
  // Phase 2C — Cosmos anchor
  "fn_anchor_decision.sql",
  // Phase 2D — Batch
  "submit_batch_job.sql",
  "update_batch_job_status.sql",
  "get_pending_batch_jobs.sql",
  // Phase 4A — Dirigent advisor
  "fn_advise_session_router.sql",
  // Phase 5 — Provider catalog + MCP lifecycle
  "aisha_resolve_clow_backend.sql",
  "aisha_evaluate_provider_for_task.sql",
  "aisha_register_mcp_server.sql",
  "aisha_test_mcp_server.sql",
  "aisha_record_mcp_test_result.sql",
];

interface RpcInfo {
  filename: string;
  filePath: string;
  content: string;
}

let rpcs: RpcInfo[] = [];

beforeAll(() => {
  rpcs = AUTOPILOT_RPC_FILES.map((filename) => {
    const filePath = path.join(SQL_FUNCTIONS_DIR, filename);
    return {
      filename,
      filePath,
      content: fs.readFileSync(filePath, "utf-8"),
    };
  });
});

describe("AISHA Autopilot RPCs — schema integrity", () => {
  it("all 22 autopilot RPC SoT files exist on disk", () => {
    for (const filename of AUTOPILOT_RPC_FILES) {
      const exists = fs.existsSync(path.join(SQL_FUNCTIONS_DIR, filename));
      expect(exists, `Missing SoT: aisha/db/sql/functions/${filename}`).toBe(true);
    }
  });
});

describe("AISHA Autopilot RPCs — SECURITY DEFINER contract", () => {
  it.each(AUTOPILOT_RPC_FILES)("%s declares SECURITY DEFINER", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} missing SECURITY DEFINER`).toMatch(/SECURITY DEFINER/);
  });

  it.each(AUTOPILOT_RPC_FILES)("%s sets search_path TO 'public'", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} missing SET search_path TO 'public'`).toMatch(
      /SET search_path TO 'public'/i,
    );
  });
});

describe("AISHA Autopilot RPCs — REVOKE/GRANT contract", () => {
  it.each(AUTOPILOT_RPC_FILES)("%s has REVOKE ALL FROM PUBLIC", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} missing REVOKE ALL ... FROM PUBLIC`).toMatch(
      /REVOKE ALL ON FUNCTION[^\n]*FROM PUBLIC/i,
    );
  });

  it.each(AUTOPILOT_RPC_FILES)("%s grants EXECUTE to authenticated", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} missing GRANT EXECUTE ... TO authenticated`).toMatch(
      /GRANT EXECUTE ON FUNCTION[^\n]*TO authenticated/i,
    );
  });

  it.each(AUTOPILOT_RPC_FILES)("%s grants EXECUTE to service_role", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} missing GRANT EXECUTE ... TO service_role`).toMatch(
      /GRANT EXECUTE ON FUNCTION[^\n]*TO service_role/i,
    );
  });
});

describe("AISHA Autopilot RPCs — admin-gated RPCs audit", () => {
  // Admin-gated RPCs MUST write to audit_journal because they mutate sensitive
  // state (slot mapping, MCP registry).
  const ADMIN_GATED = [
    "set_slot_model_mapping.sql",
    "aisha_register_mcp_server.sql",
  ];

  it.each(ADMIN_GATED)("%s uses is_admin_or_staff() check", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} should gate via is_admin_or_staff()`).toMatch(
      /is_admin_or_staff\s*\(\s*\)/,
    );
  });

  it.each(ADMIN_GATED)("%s writes to audit_journal", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} must INSERT INTO audit_journal`).toMatch(
      /INSERT INTO audit_journal/i,
    );
  });
});

describe("AISHA Autopilot RPCs — STABLE markers for read-only RPCs", () => {
  // Read-only / deterministic RPCs should be marked STABLE so query planners
  // can cache them within a transaction. This is a soft contract — we only
  // require STABLE where the RPC is documented as STABLE.
  const STABLE_RPCS = [
    "aisha_choose_execution_strategy.sql",
    "fn_get_next_graph_node.sql",
    "recommend_slot_for_task.sql",
    "get_slot_routing_table.sql",
    "get_pending_batch_jobs.sql",
    "fn_advise_session_router.sql",
    "aisha_resolve_clow_backend.sql",
    "aisha_evaluate_provider_for_task.sql",
  ];

  it.each(STABLE_RPCS)("%s is marked STABLE", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    expect(r.content, `${filename} should be marked STABLE`).toMatch(/STABLE/);
  });
});

describe("AISHA Autopilot RPCs — auth gate", () => {
  // Every RPC must authenticate (auth.uid() check OR is_admin_or_staff()).
  // STABLE+SECURITY DEFINER functions without an auth check could leak data.
  it.each(AUTOPILOT_RPC_FILES)("%s gates on auth.uid() or admin check", (filename) => {
    const r = rpcs.find((x) => x.filename === filename)!;
    const hasAuthCheck =
      /auth\.uid\s*\(\s*\)/.test(r.content) ||
      /is_admin_or_staff\s*\(\s*\)/.test(r.content);
    expect(hasAuthCheck, `${filename} must check auth.uid() or admin role`).toBe(true);
  });
});
