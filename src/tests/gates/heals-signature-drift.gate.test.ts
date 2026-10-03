/**
 * heals-signature-drift.gate.test.ts — a changed function signature must reach
 * databases that already exist.
 *
 * THE CLASS THIS EXISTS FOR (2026-07-19): removing hardcoded currency literals
 * renamed parameters across ~58 function files (p_cost_usd → p_cost,
 * p_estimated_cost_usd → p_estimated_cost, …). The generated baseline carried the
 * new names, so every fresh database — CI, and every wipe — was green. But the
 * baseline is NEVER re-applied to an initialized database, and nine of those
 * functions appeared nowhere in heals.sql, so already-deployed instances kept the
 * OLD names indefinitely. PostgREST resolves RPCs by ARGUMENT NAME, so callers
 * passing the new ones failed PGRST202 against exactly those installs.
 *
 * The failure was SILENT: migrate exited 0 and the deploy went green while nine
 * functions stayed wrong. No existing gate could see it, because every gate runs
 * against the from-zero path, which is the one path that always works.
 *
 * Two invariants, both cheap to check statically:
 *
 *  1. A source-of-truth file that carries `DROP FUNCTION IF EXISTS public.<fn>(`
 *     is DECLARING that this function's signature changed incompatibly — that is
 *     the only reason to drop before creating. Such a function must also appear
 *     in heals.sql, or the change reaches new databases only.
 *
 *  2. Where a function exists in BOTH files, the parameter NAME lists must agree.
 *     The two copies are maintained by hand; drift between them means existing
 *     databases converge on something other than the source of truth.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const FN_DIR = join(ROOT, "aisha/db/sql/functions");
const HEALS = readFileSync(join(ROOT, "aisha/db/heals.sql"), "utf8");

/** Parameter NAMES of the first `CREATE OR REPLACE FUNCTION public.<fn>(...)` in `sql`. */
function paramNames(sql: string, fn: string): string[] | null {
  const start = sql.search(
    new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "i"),
  );
  if (start === -1) return null;

  // Walk from the opening paren to its match so nested type parens (numeric(10,2))
  // and defaults do not truncate the list.
  const open = sql.indexOf("(", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  return sql
    .slice(open + 1, end)
    .split(",")
    .map((raw) => raw.replace(/--.*$/gm, "").trim())
    .filter(Boolean)
    .map((p) => p.split(/\s+/)[0].toLowerCase())
    // OUT/INOUT/VARIADIC prefix the name; keep the name itself.
    .map((n) => (["out", "inout", "in", "variadic"].includes(n) ? "" : n))
    .filter(Boolean);
}

const sotFiles = readdirSync(FN_DIR).filter((f) => f.endsWith(".sql"));

describe("heals signature drift", () => {
  test("no NEW function drops its old signature without being mirrored into heals.sql", () => {
    // Most existing DROP guards are legitimate overload cleanups — dropping a
    // DIFFERENT arity, which already-deployed databases do not need, because
    // CREATE OR REPLACE handles the current signature fine. Those are baselined.
    // What must not grow is the case that bit us: a drop of the SAME signature,
    // i.e. a rename, which CREATE OR REPLACE cannot deliver to an existing DB.
    const baseline: string[] = JSON.parse(
      readFileSync(join(__dirname, "heals-signature-drift.baseline.json"), "utf8"),
    ).functions;

    const offenders: string[] = [];
    for (const file of sotFiles) {
      const fn = file.replace(/\.sql$/, "");
      const sql = readFileSync(join(FN_DIR, file), "utf8");
      const declaresDrop = new RegExp(
        `DROP\\s+FUNCTION\\s+IF\\s+EXISTS\\s+public\\.${fn}\\s*\\(`,
        "i",
      ).test(sql);
      if (!declaresDrop) continue;

      // Doručeno = na UŽ INICIALIZOVANÉ databázi se ta změna provede. To umí DVA
      // tvary a heals používá oba (viz insert_knowledge_embedding_v2_audited):
      //   a) definice vepsaná přímo do heals.sql,
      //   b) `DROP …;` + `\ir sql/functions/<fn>.sql` — psql include, který se
      //      vykoná stejně jako inline text, jen bez duplikace zdroje pravdy.
      // Detektor uměl jen (a), takže funkci doručenou tvarem (b) hlásil jako
      // NEdoručenou. Falešný poplach patří opravit v detektoru, ne obejít
      // zápisem do baseline — ten je zmrazený právě proto, aby nerostl.
      // U (b) se ZÁMĚRNĚ vyžaduje i ten DROP: samotný `\ir` novou definici
      // vytvoří, ale starou signaturu neodstraní, a přesně o to tu jde.
      const inHealsInline = new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`,
        "i",
      ).test(HEALS);
      const inHealsInclude =
        new RegExp(`DROP\\s+FUNCTION\\s+IF\\s+EXISTS\\s+public\\.${fn}\\s*\\(`, "i").test(HEALS) &&
        new RegExp(`\\\\ir\\s+sql/functions/${fn}\\.sql`, "i").test(HEALS);
      const inHeals = inHealsInline || inHealsInclude;
      if (!inHeals && !baseline.includes(fn)) offenders.push(fn);
    }

    expect(
      offenders,
      `These functions drop an old signature before creating — the reason to do that is an ` +
        `incompatible signature change — but they are absent from aisha/db/heals.sql, so only ` +
        `NEWLY CREATED databases get the change. Already-deployed instances keep the old ` +
        `signature forever, and PostgREST (which matches RPCs by ARGUMENT NAME) then fails ` +
        `PGRST202 against exactly those installs — silently, because migrate still exits 0.\n\n` +
        `Mirror each one into heals.sql (DROP + the current definition), or, if the drop only ` +
        `removes a legacy overload of a DIFFERENT arity, add it to the baseline WITH that ` +
        `reason:\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  test("functions present in both files declare the same parameter names", () => {
    const drift: string[] = [];

    for (const file of sotFiles) {
      const fn = file.replace(/\.sql$/, "");
      const sot = paramNames(readFileSync(join(FN_DIR, file), "utf8"), fn);
      const heals = paramNames(HEALS, fn);
      if (!sot || !heals) continue; // not mirrored — covered by the test above

      if (sot.join(",") !== heals.join(",")) {
        drift.push(`${fn}\n      source-of-truth: (${sot.join(", ")})\n      heals.sql:       (${heals.join(", ")})`);
      }
    }

    expect(
      drift,
      `heals.sql carries a hand-maintained copy of these functions and it has drifted from the ` +
        `source of truth. Existing databases converge on the heals.sql version, so the two ` +
        `spellings mean deployed instances and fresh ones disagree:\n\n  - ` +
        drift.join("\n  - "),
    ).toEqual([]);
  });
});
