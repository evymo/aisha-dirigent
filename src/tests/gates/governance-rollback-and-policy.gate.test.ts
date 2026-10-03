/**
 * GATE: governance write-path — rollback executor (L5) + risk-policy CRUD.
 *  - execute_improvement_proposal_rollback_admin: SECURITY DEFINER, admin-gated (P0003), restores
 *    agent_catalog from the current_value snapshot, only for status='applied', sets 'rolled_back', audits.
 *  - set_ai_risk_policy_audited (pre-existing): admin-gated, upserts ai_risk_policies, audits.
 * Both REVOKE PUBLIC + GRANT, mutate config behind the admin gate (never silent).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const rollback = readFileSync(
  join(ROOT, "aisha/db/sql/functions/execute_improvement_proposal_rollback_admin.sql"),
  "utf8",
);
const policy = readFileSync(join(ROOT, "aisha/db/sql/functions/set_ai_risk_policy_audited.sql"), "utf8");

describe("L5 — execute_improvement_proposal_rollback_admin", () => {
  it("is SECURITY DEFINER, admin-gated, restores from the snapshot, audits", () => {
    expect(rollback).toMatch(/SECURITY\s+DEFINER/i);
    expect(rollback).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    expect(rollback, "admin gate").toMatch(/is_admin_or_staff/);
    expect(rollback, "fail-loud P0003").toMatch(/P0003/);
    expect(rollback, "only applied proposals").toMatch(/status\s*=\s*'applied'/);
    expect(rollback, "restores from current_value snapshot").toMatch(/current_value/);
    expect(rollback, "restores the agent").toMatch(/UPDATE\s+agent_catalog/i);
    expect(rollback, "marks rolled_back").toMatch(/'rolled_back'/);
    expect(rollback, "audits").toMatch(/audit_journal[\s\S]*IMPROVEMENT_PROPOSAL_ROLLED_BACK/);
  });
  it("REVOKE PUBLIC + GRANT", () => {
    expect(rollback).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
    expect(rollback).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*?service_role/);
  });
});

describe("T2 — set_ai_risk_policy_audited (per-category policy CRUD, pre-existing)", () => {
  it("is admin-gated, upserts ai_risk_policies, audits", () => {
    expect(policy).toMatch(/SECURITY\s+DEFINER/i);
    expect(policy, "admin gate").toMatch(/is_admin_or_staff/);
    expect(policy, "upserts the policy table").toMatch(/INSERT INTO[\s\S]*ai_risk_policies[\s\S]*ON CONFLICT/i);
    expect(policy, "audits").toMatch(/audit_journal/);
  });
  it("REVOKE PUBLIC + GRANT", () => {
    expect(policy).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
    expect(policy).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*?service_role/);
  });
});
