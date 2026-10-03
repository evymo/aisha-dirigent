/**
 * Self-Eval E2E Coverage Gate
 *
 * Ensures the deployed-stack E2E spec (e2e/self-eval-loop.spec.ts) keeps covering
 * the self-* loop's deployment-critical surfaces, so production verifiability is
 * not silently lost. Offline (file-content) check.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const SPEC = path.join(ROOT, "e2e/self-eval-loop.spec.ts");
const RUNBOOK = path.join(ROOT, "docs/architecture/STORY_SELF_EVALUATION_RUNBOOK.md");

describe("Self-eval E2E: deployed verification coverage", () => {
  it("e2e/self-eval-loop.spec.ts exists", () => {
    expect(fs.existsSync(SPEC), "missing e2e/self-eval-loop.spec.ts").toBe(true);
  });

  it("covers all deployment-critical surfaces of the loop", () => {
    const src = fs.readFileSync(SPEC, "utf-8");
    for (const surface of [
      "evaluate_story_self", // PR1 verdict
      "get_story_aisha_maturity", // PR1 maturity fix
      "fn_get_proposals_due_outcome_review", // PR5 loop closer
      "improvement_proposals", // PR5 outcome column
      "/dirigent/dispatch", // PR2 supervisor edge fn
    ]) {
      expect(src, `E2E spec must verify '${surface}' on the deployed stack`).toContain(surface);
    }
  });

  it("authenticates as service_role (POSTGREST_SERVICE_TOKEN) like the runner/n8n", () => {
    const src = fs.readFileSync(SPEC, "utf-8");
    expect(src).toContain("POSTGREST_SERVICE_TOKEN");
  });

  it("skips cleanly when no target/token is configured (never false-fails)", () => {
    const src = fs.readFileSync(SPEC, "utf-8");
    expect(src, "spec must guard with test.skip on missing config").toMatch(/test\.skip\(/);
  });

  it("verdict shape assertions are present (score/level/dimensions/findings/recommended_actions)", () => {
    const src = fs.readFileSync(SPEC, "utf-8");
    for (const key of ["score", "level", "dimensions", "findings", "recommended_actions"]) {
      expect(src, `E2E must assert verdict key '${key}'`).toContain(key);
    }
  });

  it("verification runbook exists", () => {
    expect(fs.existsSync(RUNBOOK), "missing STORY_SELF_EVALUATION_RUNBOOK.md").toBe(true);
  });
});
