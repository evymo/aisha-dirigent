/**
 * GATE: fn_get_decision_outcomes (L0 feedback-plane outcome read) contract.
 *
 * Fix on failure: keep the RPC SECURITY DEFINER + STABLE + search_path-pinned, with the
 * service_role/admin/participant auth gate and REVOKE-then-GRANT posture, deriving the outcome
 * over ai_decisions (joined to ai_trace_events by decision_id) — never a second SoT table
 * (ai_routing_outcomes). See docs/orchestration/FEEDBACK_PLANE_BUILD.md (L0).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SQL = readFileSync(join(ROOT, "aisha/db/sql/functions/fn_get_decision_outcomes.sql"), "utf8");

describe("fn_get_decision_outcomes — L0 outcome read contract", () => {
  it("is SECURITY DEFINER + STABLE + search_path pinned", () => {
    expect(SQL, "must be SECURITY DEFINER").toMatch(/SECURITY DEFINER/i);
    expect(SQL, "must be STABLE (read-only)").toMatch(/\bSTABLE\b/);
    expect(SQL, "must pin search_path to public").toMatch(/SET\s+search_path\s+TO\s+'public'/i);
  });

  it("auth-gates fail-closed: service_role/admin OR story participant", () => {
    expect(SQL, "must raise 42501 on unauthenticated").toMatch(/42501/);
    expect(SQL, "must consult is_admin_or_staff").toMatch(/is_admin_or_staff/);
    expect(SQL, "must scope by story_participants").toMatch(/story_participants/);
    expect(SQL, "must honor the stack-default story").toMatch(/is_stack_default/);
  });

  it("service check is the NULL-safe helper, not the fail-open inline idiom", () => {
    // The deny-guards are NEGATIVE (IF ... AND NOT v_is_service). The inline
    // (request.jwt.claims->>'role') = 'service_role' folds to SQL NULL when the
    // role claim is absent, and NULL flows through NOT → IF NULL never raises →
    // fail-OPEN. is_service_role() is boolean-NOT-NULL so the guard is total.
    expect(SQL, "must derive service via is_service_role()").toMatch(/is_service_role\s*\(/);
    expect(
      SQL,
      "must NOT read the role claim inline (fold-to-NULL fail-open risk)",
    ).not.toMatch(/current_setting\s*\(\s*'request\.jwt\.claims'[\s\S]*?->>\s*'role'\s*\)\s*=\s*'service_role'/);
  });

  it("REVOKE-then-GRANT posture (no PUBLIC execute)", () => {
    expect(SQL, "must REVOKE ALL FROM PUBLIC").toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
    expect(SQL, "must GRANT EXECUTE to authenticated").toMatch(/GRANT\s+EXECUTE[\s\S]*authenticated/i);
    expect(SQL, "must GRANT EXECUTE to service_role").toMatch(/GRANT\s+EXECUTE[\s\S]*service_role/i);
  });

  it("derives outcome over the single decision journal (no second SoT table)", () => {
    expect(SQL, "must read ai_decisions").toMatch(/\bai_decisions\b/);
    expect(SQL, "must join ai_trace_events by decision_id").toMatch(/ai_trace_events[\s\S]*decision_id/i);
    expect(SQL, "must NOT introduce ai_routing_outcomes").not.toMatch(/ai_routing_outcomes/i);
  });
});
