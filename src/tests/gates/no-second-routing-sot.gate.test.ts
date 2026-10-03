/**
 * GATE: single source of truth for execution decisions + outcomes.
 *
 * The execution-decision journal is ai_decisions (one writer: fn_record_execution_decision).
 * An execution OUTCOME is a VIEW over ai_decisions (joined to ai_trace_events / ai_runs),
 * never a second source-of-truth table. Do NOT create ai_routing_decisions /
 * ai_routing_outcomes (ZADANI §7.2 "NESTAVĚT"; see docs/orchestration/NESTAVET_RATIONALE.md
 * and GOVERNED_AUTO_EVALUATION.md §3). A materialized VIEW (derived cache) is fine; a second
 * CREATE TABLE for routing decisions/outcomes is not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function sqlFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sqlFiles(p, acc);
    else if (entry.endsWith(".sql")) acc.push(p);
  }
  return acc;
}

// CREATE TABLE ... ai_routing_decisions|ai_routing_outcomes (allows IF NOT EXISTS / schema qualifier).
const banned = /CREATE\s+TABLE[\s\S]{0,80}?\b(ai_routing_outcomes|ai_routing_decisions)\b/i;

describe("single-SoT — no second routing decisions/outcomes table", () => {
  it("no SQL creates ai_routing_outcomes / ai_routing_decisions (outcome = view over ai_decisions)", () => {
    const offenders = sqlFiles(join(ROOT, "aisha", "db")).filter((f) =>
      banned.test(readFileSync(f, "utf8")),
    );
    expect(
      offenders,
      `Execution-decision/outcome SoT must remain ai_decisions (outcome = view, not a 2nd table). ` +
        `Offending SQL file(s): ${offenders.map((f) => f.replace(ROOT + "/", "")).join(", ")}`,
    ).toHaveLength(0);
  });
});
