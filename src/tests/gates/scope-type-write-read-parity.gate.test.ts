/**
 * Gate — scope_type write ⊇ read parity (governance fail-open guard).
 *
 * ai_budget / ai_spend_policies / ai_risk_policies each declare a CHECK on the
 * scope_type values they ACCEPT (writable). The enforcer functions only READ a
 * subset (today: story + global). The unread scopes (partner, agent) are an
 * INTENTIONAL forward-looking seam — recorded as `@scope-reserved:` in each
 * table SoT — not a fail-open: nothing writes them and the platform's governed
 * axis is story/context (multi-instance = per-context/knowledgebase).
 *
 * This gate keeps that contract honest WITHOUT a maintained roster of permitted
 * names: for each table it asserts every CHECK scope is either
 *   (a) actually READ by that table's enforcer fn(s)  — derived from the fn SoT, or
 *   (b) explicitly RESERVED in the table SoT `@scope-reserved:` marker.
 * A future scope added to a CHECK that is silently neither (a real fail-open) —
 * or a stale `@scope-reserved:` for a scope the CHECK doesn't even allow — fails
 * the gate at PR time. The enforced set is DERIVED from code (the fn reads), and
 * the reserved set is a per-entity self-declaration; the table→enforcer mapping
 * below is structural wiring (which fn enforces which table), not a name-list.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const TBL = (t: string) => join(ROOT, "aisha", "db", "sql", "tables", `${t}.sql`);
const FN = (f: string) => join(ROOT, "aisha", "db", "sql", "functions", `${f}.sql`);

/** Which enforcer fn(s) READ each governance table's scope_type (structural wiring). */
const ENFORCERS: Record<string, string[]> = {
  ai_budget: ["fn_check_and_consume_ai_budget_audited"],
  ai_spend_policies: ["fn_authorize_task_spend"],
  ai_risk_policies: ["fn_admit_clow"],
  // The resolver reads the GLOBAL scope; story + instance are @scope-reserved forward seams.
  ai_resolver_policy: ["aisha_resolve_clow_backend"],
};

/** Scope values an SQL body READS, e.g. `sp.scope_type = 'story'` or `scope_type IN ('a','b')`. */
function readScopes(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/scope_type\s*=\s*'(\w+)'/g)) out.add(m[1]);
  for (const m of sql.matchAll(/scope_type\s+IN\s*\(([^)]*)\)/gi)) {
    for (const q of m[1].matchAll(/'(\w+)'/g)) out.add(q[1]);
  }
  return out;
}

/** The scope values a table's scope_type CHECK ACCEPTS (writable). */
function writableScopes(tableSql: string): Set<string> {
  const m = tableSql.match(/CHECK\s*\(\s*scope_type\s+IN\s*\(([^)]*)\)/i);
  const out = new Set<string>();
  if (m) for (const q of m[1].matchAll(/'(\w+)'/g)) out.add(q[1]);
  return out;
}

/** The `@scope-reserved: a, b` self-declaration in a table SoT (forward-looking seam). */
function reservedScopes(tableSql: string): Set<string> {
  const m = tableSql.match(/@scope-reserved:\s*([^\n]+)/);
  const out = new Set<string>();
  if (m) for (const s of m[1].split(",")) { const t = s.trim().replace(/[.;]+$/, ""); if (/^\w+$/.test(t)) out.add(t); }
  return out;
}

describe("scope_type write ⊇ read parity — governance fail-open guard", () => {
  for (const [table, fns] of Object.entries(ENFORCERS)) {
    test(`${table}: every writable scope_type is enforced or @scope-reserved`, () => {
      const tableSql = readFileSync(TBL(table), "utf-8");
      const writable = writableScopes(tableSql);
      expect(writable.size, `${table}: could not parse a scope_type CHECK`).toBeGreaterThan(0);

      const reserved = reservedScopes(tableSql);
      const enforced = new Set<string>();
      for (const fn of fns) for (const s of readScopes(readFileSync(FN(fn), "utf-8"))) enforced.add(s);
      // 'global' is the unscoped catch-all every policy reader honors implicitly.
      enforced.add("global");

      const unaccounted = [...writable].filter((s) => !enforced.has(s) && !reserved.has(s));
      expect(
        unaccounted,
        `${table}: scope_type(s) accepted by the CHECK but NEITHER read by ${fns.join("/")} NOR ` +
          `declared '@scope-reserved:' in the table SoT — a silent fail-open. Either wire the reader ` +
          `or add them to the @scope-reserved marker (with rationale): ${unaccounted.join(", ")}`,
      ).toEqual([]);

      const staleReserved = [...reserved].filter((s) => !writable.has(s));
      expect(
        staleReserved,
        `${table}: @scope-reserved lists scope(s) the CHECK does not accept (stale): ${staleReserved.join(", ")}`,
      ).toEqual([]);
    });
  }

  test("has teeth: an unenforced + unreserved CHECK scope is flagged", () => {
    // Synthetic table SoT with a third scope 'org' that no enforcer reads and that is
    // NOT in @scope-reserved → must be reported as a fail-open.
    const fakeTable = `CHECK (scope_type IN ('story', 'partner', 'org'))\n-- @scope-reserved: partner`;
    const writable = writableScopes(fakeTable);
    const reserved = reservedScopes(fakeTable);
    const enforced = new Set<string>(["story", "global"]);
    const unaccounted = [...writable].filter((s) => !enforced.has(s) && !reserved.has(s));
    expect(unaccounted).toEqual(["org"]);
  });
});
