/**
 * GATE: L1 — fn_rollup_outcomes_to_benchmark is a REACTIVE, ADVISORY-ONLY rollup.
 *
 * Binding invariants this gate locks (fail-loud on regression):
 *  - SECURITY DEFINER + pinned search_path + service_role/admin-only auth (it writes telemetry).
 *  - Writes the SEPARATE ai_model_reliability sink via record_model_reliability.
 *  - NEVER writes ai_model_benchmarks (the resolver ranks on that table with no dedup; a second row
 *    there fans out candidates + leaks telemetry into the quality score). This is the C1 lock:
 *    the rollup must not reference insert_model_benchmark / record_model_benchmark at all.
 *  - Model identity is (provider, model_id) — joins on reg.provider = d.provider_slug — so a model_id
 *    served by two providers is never conflated (C2 lock).
 *  - Quality (avg_eval) is sourced ONLY from a real eval (faithfulness_score_estimate) and is carried
 *    as advisory observability (p_avg_eval_score), never wired into success_rate.
 *  - Keys on the normalized task_kind and records observed kinds.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const fn = readFileSync(
  join(ROOT, "aisha/db/sql/functions/fn_rollup_outcomes_to_benchmark.sql"),
  "utf8",
);

describe("L1 — fn_rollup_outcomes_to_benchmark (reliability-sink rollup) contract", () => {
  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(fn, "must be SECURITY DEFINER").toMatch(/SECURITY\s+DEFINER/i);
    expect(fn, "must pin search_path").toMatch(/SET\s+search_path\s+TO\s+'public'/i);
  });

  it("is service_role/admin-gated and fails loud (42501)", () => {
    expect(fn, "must check service_role").toMatch(/request\.jwt\.claims[\s\S]*?service_role/);
    expect(fn, "must check admin/staff").toMatch(/is_admin_or_staff/);
    expect(fn, "must raise 42501 when unauthorized").toMatch(/42501/);
  });

  it("writes the reliability sink, NEVER ai_model_benchmarks (C1 lock)", () => {
    expect(fn, "must write via record_model_reliability").toMatch(/record_model_reliability/);
    expect(fn, "must NOT append to benchmarks").not.toMatch(/insert_model_benchmark/);
    expect(fn, "must NOT replace benchmarks either").not.toMatch(/record_model_benchmark\b/);
    expect(fn, "must NOT touch ai_model_benchmarks at all").not.toMatch(/ai_model_benchmarks/);
  });

  it("joins on (provider, model_id) so providers are not conflated (C2 lock)", () => {
    expect(fn, "must join provider too").toMatch(/reg\.provider\s*=\s*d\.provider_slug/);
    expect(fn, "must require provider_slug present").toMatch(/d\.provider_slug\s+IS NOT NULL/);
  });

  it("derives quality (avg_eval) from a real eval, kept advisory — NOT from success_rate", () => {
    expect(fn, "avg_eval must come from faithfulness_score_estimate").toMatch(/faithfulness_score_estimate/);
    expect(fn, "avg_eval feeds p_avg_eval_score (advisory)").toMatch(/p_avg_eval_score\s*=>\s*rec\.avg_eval/);
    expect(fn, "success_rate must be reliability, not the eval").toMatch(/p_success_rate\s*=>\s*rec\.success_rate/);
  });

  it("keys on the normalized task_kind and records observed kinds", () => {
    expect(fn, "must normalize the grouping key").toMatch(/normalize_task_kind\(d\.decision_json->>'task_kind'\)/);
    expect(fn, "must record observed kinds").toMatch(/fn_observe_task_kind/);
  });

  it("grants EXECUTE to service_role only, not PUBLIC", () => {
    expect(fn).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC/);
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role/);
  });
});
