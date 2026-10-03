/**
 * GATE: runtime axis enum/CHECK parity (no drift).
 *
 * The runtime (executor) axis is declared in THREE places that must stay in lockstep:
 *   1. services/svc-ai-chat/src/reflection/decision.ts  — AishaRuntimeSchema (z.enum)
 *   2. aisha/db/sql/tables/ai_decisions.sql             — runtime CHECK (the decision journal)
 *   3. aisha/db/sql/tables/ai_runtime_registry.sql      — runtime_kind CHECK (the runtime catalog)
 *
 * Fix on failure: add (or remove) the runtime value in ALL THREE (the SQL changes need a
 * forward migration in aisha/db/migrations/). A runtime that decision.ts/the registry allow
 * but the ai_decisions CHECK does not will fail fn_record_execution_decision — and because
 * dispatch is fail-closed (I1: "no dispatch without a journaled decision"), the whole dispatch
 * hard-fails. This gate makes that drift impossible to merge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Single-quoted lowercase tokens inside the first block captured by `blockRe` (group 1). */
function valuesIn(src: string, blockRe: RegExp): Set<string> {
  const m = src.match(blockRe);
  const toks = m ? m[1].match(/'([a-z_]+)'/g) ?? [] : [];
  return new Set(toks.map((t) => t.replace(/'/g, "")));
}
const sorted = (s: Set<string>) => [...s].sort().join(",");
const eq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

const tsRuntimes = valuesIn(
  read("services/svc-ai-chat/src/reflection/decision.ts"),
  /AishaRuntimeSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/,
);
const decisionsCheck = valuesIn(
  read("aisha/db/sql/tables/ai_decisions.sql"),
  /CHECK\s*\(\s*runtime\s+IN\s*\(([\s\S]*?)\)\s*\)/i,
);
const registryCheck = valuesIn(
  read("aisha/db/sql/tables/ai_runtime_registry.sql"),
  /CHECK\s*\(\s*runtime_kind\s+IN\s*\(([\s\S]*?)\)\s*\)/i,
);

describe("runtime axis — enum/CHECK parity (no drift)", () => {
  it("AishaRuntimeSchema parsed (sanity)", () => {
    expect(
      tsRuntimes.size,
      "could not parse AishaRuntimeSchema = z.enum([...]) in reflection/decision.ts",
    ).toBeGreaterThan(0);
  });

  it("ai_decisions.runtime CHECK == decision.ts AISHA_RUNTIMES", () => {
    expect(
      eq(decisionsCheck, tsRuntimes),
      `DRIFT: ai_decisions.runtime CHECK [${sorted(decisionsCheck)}] != decision.ts AISHA_RUNTIMES ` +
        `[${sorted(tsRuntimes)}]. Widen the runtime CHECK in aisha/db/sql/tables/ai_decisions.sql ` +
        `(+ a forward migration in aisha/db/migrations/) — or remove the value from AishaRuntimeSchema. ` +
        `A runtime journaled by fn_record_execution_decision but absent from the CHECK hard-fails the ` +
        `dispatch (fail-closed I1).`,
    ).toBe(true);
  });

  it("ai_runtime_registry.runtime_kind CHECK == decision.ts AISHA_RUNTIMES", () => {
    expect(
      eq(registryCheck, tsRuntimes),
      `DRIFT: ai_runtime_registry.runtime_kind CHECK [${sorted(registryCheck)}] != decision.ts ` +
        `AISHA_RUNTIMES [${sorted(tsRuntimes)}]. Keep the registry catalog and the TS enum in lockstep.`,
    ).toBe(true);
  });
});
