/**
 * Gate: eval-before-migration (G4 — odysseus impl/14, Anthropic operating
 * model impl/13 §5.2) stays wired into the model-activation surface.
 *
 * The runtime enforcement lives in set_active_ai_model_admin (SoT function +
 * pgTAP aisha/db/tests/schema/18_eval_before_migration_gate.sql runs it
 * against a real DB). This static gate is the fast-feedback guard: the gate
 * block must exist in the SoT, be fail-closed (missing benchmark = FAIL, not
 * silent pass), read its threshold from warm config, and be carried by the
 * generated baseline — so a future rewrite of the function cannot silently
 * drop the eval requirement.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const FN = "aisha/db/sql/functions/set_active_ai_model_admin.sql";
const BASELINE = "aisha/db/migrations/00000000000000_baseline.sql";
const SEED = "aisha/db/seed/core/07_system_config.sql";

describe("eval-before-migration gate (G4)", () => {
  test("SoT: activation path enforces eval_status + benchmark threshold, fail-closed", () => {
    const sql = read(FN);
    expect(sql, "gate block must exist").toMatch(/Eval-before-migration gate/i);
    expect(sql, "gate must check the eval lifecycle state").toMatch(
      /eval_status\s+NOT\s+IN\s*\(\s*'tested'\s*,\s*'approved'\s*\)/i,
    );
    expect(sql, "gate must be fail-closed on a MISSING benchmark").toMatch(
      /v_best_score\s+IS\s+NULL/i,
    );
    expect(sql, "gate must compare against the warm-config threshold").toMatch(
      /eval_min_overall_score/,
    );
    expect(sql, "gate must read current benchmarks").toMatch(/ai_model_benchmarks/);
    expect(sql, "gate must block with a constraint-violation errcode").toMatch(/23514/);
    // The gate must run only on ACTIVATION — deactivation stays ungated.
    expect(sql).toMatch(/IF\s+p_is_active\s+THEN[\s\S]*Eval-before-migration|Eval-before-migration[\s\S]*IF\s+p_is_active\s+THEN/i);
  });

  test("threshold is seeded in system_config['ai_runtime'] (operator-tunable, no redeploy)", () => {
    const seed = read(SEED);
    expect(seed).toMatch(/"eval_min_overall_score"\s*:\s*0?\.\d+/);
  });

  test("generated baseline carries the gate (regen drift guard)", () => {
    const base = read(BASELINE);
    expect(base, "baseline must be regenerated after the SoT change (npm run db:init:generate)").toMatch(
      /Eval-before-migration gate/i,
    );
    expect(base).toMatch(/eval_min_overall_score/);
  });

  test("pgTAP behavioral proof exists and covers the fail-closed branch", () => {
    const tap = read("aisha/db/tests/schema/18_eval_before_migration_gate.sql");
    expect(tap).toMatch(/fail-closed/i);
    expect(tap).toMatch(/throws_ok/);
    expect(tap).toMatch(/set_active_ai_model_admin/);
  });
});
