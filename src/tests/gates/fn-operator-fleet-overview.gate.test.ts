/**
 * GATE: operator observability — fn_operator_fleet_overview.
 *  - STABLE, read-only (no INSERT/UPDATE/DELETE), SECURITY DEFINER + pinned search_path.
 *  - service_role/admin-gated, fail-loud (42501).
 *  - Derives over the SoT (ai_runs, ai_decisions, ai_trace_events, improvement_proposals,
 *    ai_model_reliability) — never a second aggregate table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const fn = readFileSync(join(ROOT, "aisha/db/sql/functions/fn_operator_fleet_overview.sql"), "utf8");

describe("operator fleet overview — contract", () => {
  it("is STABLE, SECURITY DEFINER, pinned search_path, gated", () => {
    expect(fn).toMatch(/\bSTABLE\b/);
    expect(fn).toMatch(/SECURITY\s+DEFINER/i);
    expect(fn).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    expect(fn, "service_role check").toMatch(/request\.jwt\.claims[\s\S]*?service_role/);
    expect(fn, "admin check").toMatch(/is_admin_or_staff/);
    expect(fn, "fail-loud").toMatch(/42501/);
  });

  it("is read-only (no writes)", () => {
    expect(fn).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(fn).not.toMatch(/\bUPDATE\s+public\./i);
    expect(fn).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("aggregates the orchestration SoT", () => {
    expect(fn).toMatch(/ai_runs/);
    expect(fn).toMatch(/ai_decisions/);
    expect(fn).toMatch(/ai_trace_events/);
    expect(fn).toMatch(/improvement_proposals/);
    expect(fn).toMatch(/ai_model_reliability/);
  });

  it("grants EXECUTE (not PUBLIC)", () => {
    expect(fn).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO[\s\S]*?service_role/);
  });
});
