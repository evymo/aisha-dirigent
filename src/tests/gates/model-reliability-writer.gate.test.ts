/**
 * GATE: L1 — ai_model_reliability sink + record_model_reliability writer.
 *
 *  - The table is SEPARATE from ai_model_benchmarks (so telemetry never enters the ranked table),
 *    has one current row per (model_registry_id, task_kind) via UNIQUE, FKs the registry, and has RLS.
 *  - The writer is SECURITY DEFINER, service_role/admin-gated, normalizes task_kind, upserts (REPLACE
 *    grain), grants to service_role only, and does NOT write ai_model_benchmarks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const table = readFileSync(join(ROOT, "aisha/db/sql/tables/ai_model_reliability.sql"), "utf8");
const writer = readFileSync(join(ROOT, "aisha/db/sql/functions/record_model_reliability.sql"), "utf8");

describe("L1 — ai_model_reliability table", () => {
  it("is a separate sink with one current row per (model, task_kind)", () => {
    expect(table, "must define the reliability table").toMatch(/CREATE TABLE[\s\S]*?ai_model_reliability/i);
    expect(table, "must be one row per pair").toMatch(/UNIQUE\s*\(model_registry_id,\s*task_kind\)/i);
    expect(table, "must FK the model registry").toMatch(/REFERENCES\s+public\.ai_model_registry/i);
    expect(table, "must enable RLS").toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

describe("L1 — record_model_reliability writer", () => {
  it("is SECURITY DEFINER, gated, normalizing, upserting", () => {
    expect(writer).toMatch(/SECURITY\s+DEFINER/i);
    expect(writer).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    expect(writer, "must check service_role via the NULL-safe is_service_role() helper").toMatch(/is_service_role\(\)/);
    expect(writer, "must NOT use the fail-open loose guard (IS DISTINCT FROM)").not.toMatch(/IS DISTINCT FROM 'service_role'/);
    expect(writer, "must check admin/staff").toMatch(/is_admin_or_staff/);
    expect(writer, "must raise 42501").toMatch(/42501/);
    expect(writer, "must normalize task_kind").toMatch(/normalize_task_kind/);
    expect(writer, "must upsert one current row").toMatch(/ON CONFLICT\s*\(model_registry_id,\s*task_kind\)\s*DO UPDATE/i);
  });

  it("never writes the ranked benchmarks table", () => {
    // Forbid an actual WRITE to the ranked table (allow the name in explanatory comments).
    expect(writer, "must NOT write ai_model_benchmarks").not.toMatch(
      /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?ai_model_benchmarks\b/i,
    );
  });

  it("grants EXECUTE to service_role only, not PUBLIC", () => {
    expect(writer).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
    expect(writer).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role/);
  });
});
