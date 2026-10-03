/**
 * GATE: L0-c — the journaled decision carries task_kind + the per-candidate ranking.
 *
 * Fix on failure: keep ClowBackend + AishaExecutionDecisionSchema + toExecutionDecision threading
 * `task_kind` + `candidates`, and openclaw_resolve_clow enriching `state.clow_backend` with them.
 * fn_record_execution_decision stores the full decision blob, so these land in
 * ai_decisions.decision_json — the substrate the orchestration-decision proof harness and the L1
 * outcome rollup read (per-candidate scores + the benchmark join key task_kind).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const decision = readFileSync(
  join(ROOT, "services/svc-ai-chat/src/reflection/decision.ts"),
  "utf8",
);
const resolver = readFileSync(
  join(ROOT, "services/svc-ai-chat/src/reflection/nodes/openclaw_resolve_clow.ts"),
  "utf8",
);

describe("L0-c — decision journal carries task_kind + candidates", () => {
  it("AishaExecutionDecisionSchema declares optional task_kind + candidates", () => {
    expect(decision, "schema must allow task_kind").toMatch(/task_kind:\s*z\.string\(\)\.optional\(\)/);
    expect(decision, "schema must allow candidates").toMatch(
      /candidates:\s*z\.array\([\s\S]*?\)\.optional\(\)/,
    );
  });

  it("ClowBackend carries task_kind + candidates", () => {
    expect(decision, "ClowBackend must include task_kind").toMatch(/task_kind\?:\s*string/);
    expect(decision, "ClowBackend must include candidates").toMatch(/candidates\?:\s*unknown\[\]/);
  });

  it("toExecutionDecision threads them from the clow into the decision", () => {
    expect(decision, "must set task_kind from clow").toMatch(/task_kind:\s*clow\?\.task_kind/);
    expect(decision, "must set candidates from clow").toMatch(/candidates:\s*clow\?\.candidates/);
  });

  it("openclaw_resolve_clow enriches clow_backend with task_kind + candidates", () => {
    expect(
      resolver,
      "resolver must thread task_kind + candidates onto clow_backend",
    ).toMatch(/task_kind:[\s\S]{0,120}?candidates:/);
  });
});
