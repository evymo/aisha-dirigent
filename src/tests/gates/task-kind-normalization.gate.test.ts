/**
 * GATE: T1 — task_kind taxonomy is NORMALIZED but never OSSIFIED.
 *
 * The owner's binding rule ("abychom nikde nezatvrdli"): we may normalize + observe task_kinds,
 * but the set must stay OPEN — no enum / DOMAIN / CHECK may ever close it. This gate fails loudly
 * if someone later tries to hardcode the vocabulary.
 *
 *  - normalize_task_kind: pure/IMMUTABLE, lower/trim/collapse, empty→'chat' (resolver default).
 *  - ai_task_kind_registry: free-text PK, descriptive — NOT a CHECK/enum/DOMAIN.
 *  - fn_observe_task_kind: SECURITY DEFINER, service_role/admin-gated, normalize + upsert.
 *  - the L1 rollup keys on normalize_task_kind(...) and records via fn_observe_task_kind.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const r = (p: string) => readFileSync(join(ROOT, p), "utf8");

const normalize = r("aisha/db/sql/functions/normalize_task_kind.sql");
const registry = r("aisha/db/sql/tables/ai_task_kind_registry.sql");
const observe = r("aisha/db/sql/functions/fn_observe_task_kind.sql");
const rollup = r("aisha/db/sql/functions/fn_rollup_outcomes_to_benchmark.sql");

describe("T1 — normalize_task_kind (pure, idempotent, open)", () => {
  it("is IMMUTABLE and pure (no SECURITY DEFINER on a pure helper)", () => {
    expect(normalize, "must be IMMUTABLE").toMatch(/\bIMMUTABLE\b/);
    expect(normalize, "pure helper must NOT be SECURITY DEFINER").not.toMatch(/SECURITY\s+DEFINER/i);
  });
  it("lower/trim/collapse-whitespace with empty→chat default", () => {
    expect(normalize).toMatch(/lower\(\s*btrim/i);
    expect(normalize).toMatch(/regexp_replace/i);
    expect(normalize, "empty/NULL must default to chat").toMatch(/'chat'/);
  });
});

describe("T1 — ai_task_kind_registry is OBSERVED, never an enum", () => {
  it("uses a free-text PK and does NOT close the set", () => {
    expect(registry, "task_kind must be a free-text PRIMARY KEY").toMatch(/task_kind\s+text\s+PRIMARY KEY/i);
    // Anti-ossification: no CHECK on task_kind, no enum TYPE, no DOMAIN.
    expect(registry, "must NOT CHECK-constrain task_kind").not.toMatch(/CHECK\s*\(\s*task_kind/i);
    expect(registry, "must NOT define an enum TYPE").not.toMatch(/CREATE\s+TYPE/i);
    expect(registry, "must NOT define a DOMAIN").not.toMatch(/CREATE\s+DOMAIN/i);
  });
});

describe("T1 — fn_observe_task_kind (descriptive recorder)", () => {
  it("is SECURITY DEFINER, gated, and upserts the normalized kind", () => {
    expect(observe).toMatch(/SECURITY\s+DEFINER/i);
    expect(observe, "must check service_role").toMatch(/request\.jwt\.claims[\s\S]*?service_role/);
    expect(observe, "must check admin/staff").toMatch(/is_admin_or_staff/);
    expect(observe, "must raise 42501").toMatch(/42501/);
    expect(observe, "must normalize before storing").toMatch(/normalize_task_kind/);
    expect(observe, "must upsert (descriptive, never reject)").toMatch(/ON CONFLICT\s*\(task_kind\)\s*DO UPDATE/i);
  });
});

describe("T1 — L1 rollup wires normalization + observation", () => {
  it("keys benchmarks on the normalized task_kind and records observed kinds", () => {
    expect(rollup, "rollup must normalize the grouping key").toMatch(
      /normalize_task_kind\(d\.decision_json->>'task_kind'\)/,
    );
    expect(rollup, "rollup must record observed kinds").toMatch(/fn_observe_task_kind/);
  });
});
