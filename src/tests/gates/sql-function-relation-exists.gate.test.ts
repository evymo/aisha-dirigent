/**
 * Gate: a LANGUAGE sql function must not reference a relation that has no SoT
 * definition — otherwise the baseline cannot be applied to a CLEAN database.
 *
 * WHY THIS EXISTS (incident 2026-07-25):
 * `get_my_workflow_steps` and `workflow_step_visible_to` shipped as LANGUAGE sql
 * and selected from `twin_external_refs`, a table that lives only in an optional
 * identity layer and has no SoT file. Postgres validates a LANGUAGE sql body at
 * CREATE FUNCTION time, so the baseline died with
 *   ERROR: relation "twin_external_refs" does not exist
 * on every fresh install — cold-start of any NEW instance was broken, while every
 * existing instance (which happened to have the table) looked perfectly healthy.
 * That asymmetry is what makes the class dangerous: it is invisible in the very
 * place people verify.
 *
 * WHAT IT PINS (the property, not the spelling): every relation a LANGUAGE sql
 * body can reach at parse time must be creatable from the source of truth.
 *
 * DELIBERATELY OUT OF SCOPE:
 *   - plpgsql bodies — not parsed at CREATE; they fail at call time instead, which
 *     is a runtime bug, not a cold-start blocker.
 *   - dynamic SQL inside dollar-quoted strings — never parsed at CREATE. This is
 *     the sanctioned way to depend on an OPTIONAL subsystem: guard with
 *     `to_regclass(...) IS NOT NULL` and EXECUTE, so the core degrades instead of
 *     refusing to install (see workflow_step_visible_to).
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SQL_ROOT = join(process.cwd(), "aisha/db/sql");

function sqlFiles(dir: string): string[] {
  try {
    return readdirSync(join(SQL_ROOT, dir)).filter((f) => f.endsWith(".sql"));
  } catch {
    return [];
  }
}

/** Set-returning functions and syntax keywords that legitimately follow FROM/JOIN. */
const NON_RELATIONS = new Set([
  "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_each", "jsonb_each_text",
  "jsonb_to_recordset", "json_array_elements", "unnest", "generate_series",
  "regexp_matches", "regexp_split_to_table", "string_to_table",
  "each", "lateral", "values", "only", "dual", "rows",
  // `IS [NOT] DISTINCT FROM NULL` puts a keyword right after FROM. `null` can
  // never name a relation, so treating it as one is a false positive that would
  // push authors to reword correct SQL to appease the parser.
  "null",
]);

function knownRelations(): Set<string> {
  const known = new Set<string>();
  for (const kind of ["tables", "views"]) {
    for (const f of sqlFiles(kind)) {
      known.add(f.replace(/\.sql$/, "").toLowerCase());
      const src = readFileSync(join(SQL_ROOT, kind, f), "utf8");
      // a single file may define more than one relation
      for (const m of src.matchAll(
        /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_]\w*)"?/gi,
      )) {
        known.add(m[1].toLowerCase());
      }
    }
  }
  return known;
}

/** Function bodies stripped of comments, dynamic SQL and every FROM that is a keyword inside an expression. */
function parseTimeBody(raw: string): string | null {
  // The language is declared BEFORE the body — reading it from the whole file
  // would let a comment mentioning "LANGUAGE sql" misclassify a plpgsql function.
  const declaration = raw.split(/\bAS\s+\$/i)[0];
  if (!/language\s+sql\b/i.test(declaration)) return null;

  const body = [...raw.matchAll(/AS\s+\$(\w*)\$([\s\S]*?)\$\1\$/gi)].map((m) => m[2]).join("\n");
  return normalizeBody(body);
}

function normalizeBody(raw: string): string {
  let body = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  body = body.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  body = body.replace(/\$(\w+)\$[\s\S]*?\$\1\$/g, " "); // nested dollar-quote = dynamic SQL
  body = neutralizeKeywordFrom(body);                    // EXTRACT/SUBSTRING/TRIM/OVERLAY(… FROM …)
  // `a IS [NOT] DISTINCT FROM <expr>` is a comparison OPERATOR, not a FROM
  // clause: whatever follows is an expression — `lower(x)`, `coalesce(…)`, a
  // column. Found 2026-09-26 by get_workflow_my_steps_block
  // (`… is distinct from lower(cfg.src_state->>'closed_when')` → "relation
  // lower"). Only the keyword pair is neutralised, so a subquery on the right —
  // `is distinct from (select … from t)` — still has its own FROM checked. The
  // `null` entry in NON_RELATIONS predates this and stays harmless.
  body = body.replace(/\bis\s+(?:not\s+)?distinct\s+from\b/gi, " is_distinct_op ");
  return body;
}

/**
 * FROM as a KEYWORD ARGUMENT of a call — `EXTRACT(x FROM y)`,
 * `SUBSTRING(s FROM n [FOR m])`, `TRIM([BOTH|LEADING|TRAILING] [c] FROM s)`,
 * `OVERLAY(s PLACING t FROM n [FOR m])` — is not a FROM clause. SQL grammar only
 * admits a FROM clause inside such a call through a SUBQUERY, i.e. one paren
 * level deeper, so a FROM at the call's own argument depth is always the
 * keyword and neutralising exactly those can never hide a relation.
 *
 * Measured 2026-09-26 over aisha/db/sql/functions (LANGUAGE sql bodies — plpgsql
 * is out of scope): EXTRACT ×3, SUBSTRING ×3, TRIM/OVERLAY ×0. None was reported
 * then, but only by luck of the argument: every SUBSTRING had a string literal
 * after FROM. `substring(s from pos)` or `trim(both from name)` would report the
 * relation "pos"/"name". The former EXTRACT rule cut the call at its first `)`,
 * which was the same idea without paren depth.
 *
 * `POSITION(a IN b)` has no FROM at all, so it cannot misfire; the test pins it.
 * String literals are skipped so a regex such as `'^\\((.*)$'` cannot skew depth.
 */
const KEYWORD_FROM_CALL = /\b(?:extract|substring|trim|overlay)\s*\(/gi;

function neutralizeKeywordFrom(body: string): string {
  const out = body.split("");
  for (const m of body.matchAll(KEYWORD_FROM_CALL)) {
    let depth = 1;
    for (let i = (m.index ?? 0) + m[0].length; i < body.length && depth > 0; i++) {
      const ch = body[i];
      if (ch === "'") {
        const end = body.indexOf("'", i + 1);
        if (end < 0) break;
        i = end;
      } else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (
        depth === 1 &&
        /^from$/i.test(body.slice(i, i + 4)) &&
        !/\w/.test(body[i - 1] ?? "") &&
        !/\w/.test(body[i + 4] ?? "")
      ) {
        out.splice(i, 4, "f", "r", "0", "m"); // same length: later indices stay valid
        i += 3;
      }
    }
  }
  return out.join("");
}

/** Relations a parse-time body reaches that the source of truth cannot create. */
function offendersIn(file: string, body: string, known: Set<string>, functions: Set<string>): string[] {
  // CTE names, including the three shapes the first version missed
  // (found 2026-08-02 by `twin_graph_descendants`, a recursive walk over
  // twin_relations):
  //   · WITH RECURSIVE walk AS (…)   — `RECURSIVE` sits between WITH and the
  //     name, so the name never matched and every `FROM walk` inside the
  //     recursive term looked like an unknown relation;
  //   · WITH x (a, b) AS (…)         — optional column list;
  //   · … AS [NOT] MATERIALIZED (…)  — planner hint before the body.
  // The old pattern therefore red-flagged ANY recursive CTE. That is a false
  // positive of the detector, not a fault in the SQL — and recursive CTEs are
  // exactly how hierarchy over the twin graph is walked, so leaving it would
  // have pushed authors to reword correct SQL to appease the parser.
  const ctes = new Set(
    [
      ...body.matchAll(
        /(?:with(?:\s+recursive)?|,)\s+([a-z_]\w*)\s*(?:\([^)]*\)\s*)?as\s*(?:not\s+)?(?:materialized\s*)?\(/gi,
      ),
    ].map((m) => m[1].toLowerCase()),
  );

  const offenders: string[] = [];
  for (const m of body.matchAll(/\b(?:from|join)\s+(?!\()(public\.)?"?([a-z_]\w*)"?/gi)) {
    const rel = m[2].toLowerCase();
    if (rel.startsWith("pg_") || rel === "information_schema") continue;
    if (NON_RELATIONS.has(rel) || ctes.has(rel) || known.has(rel) || functions.has(rel)) continue;
    offenders.push(`${file} → ${rel}`);
  }
  return offenders;
}

describe("SQL function → relation existence (baseline must apply to a clean DB)", () => {
  test("no LANGUAGE sql function references a relation missing from the source of truth", () => {
    const known = knownRelations();
    const functions = new Set(sqlFiles("functions").map((f) => f.replace(/\.sql$/, "").toLowerCase()));
    const offenders: string[] = [];

    for (const file of sqlFiles("functions")) {
      const raw = readFileSync(join(SQL_ROOT, "functions", file), "utf8");
      const body = parseTimeBody(raw);
      if (body === null) continue;
      offenders.push(...offendersIn(file, body, known, functions));
    }

    expect(
      [...new Set(offenders)],
      "A LANGUAGE sql body is validated at CREATE FUNCTION time, so these references " +
        "break the baseline on a CLEAN database (cold-start of every new instance) while " +
        "existing installs stay green. Fix by adding the relation to aisha/db/sql/tables, " +
        "or — when the dependency is on an OPTIONAL subsystem — move the reference behind " +
        "`to_regclass(...) IS NOT NULL` + EXECUTE in a plpgsql function, as " +
        "workflow_step_visible_to does.",
    ).toEqual([]);
  });

  test("IS [NOT] DISTINCT FROM is an operator — but a subquery behind it is still checked", () => {
    // Pins the DETECTOR, not the tree: a false positive here pushes authors to
    // reword correct SQL, a false negative lets a cold-start blocker through.
    const known = new Set(["li_source_registry"]);
    const none = new Set<string>();
    const scan = (sql: string) => offendersIn("fixture.sql", normalizeBody(sql), known, none);

    expect(scan(`select 1 from li_source_registry r
                  where lower(r.doc_slug) is distinct from lower($1)
                     or r.doc_slug is not distinct from coalesce($2, '')
                     or r.doc_slug IS DISTINCT FROM upper($3)`)).toEqual([]);

    // Negative control: neutralising the operator must not blind the scan.
    expect(scan(`select 1 from li_source_registry r
                  where r.doc_slug is distinct from (select x from chybejici_tabulka)`))
      .toEqual(["fixture.sql → chybejici_tabulka"]);
    expect(scan(`select 1 from chybejici_tabulka`)).toEqual(["fixture.sql → chybejici_tabulka"]);
  });
  test("FROM as a keyword argument (EXTRACT/SUBSTRING/TRIM/OVERLAY) is not a relation — a subquery inside still is", () => {
    const known = new Set(["li_source_registry"]);
    const none = new Set<string>();
    const scan = (sql: string) => offendersIn("fixture.sql", normalizeBody(sql), known, none);
    const MISSING = ["fixture.sql → chybejici_tabulka"];

    // Each shape with an IDENTIFIER after FROM — the form the tree only avoided by luck.
    for (const expr of [
      "extract(epoch from p_created_at)",
      "extract(epoch FROM (now() - r.ingested_at))",
      "substring(r.doc_slug from pos)",
      "SUBSTRING(r.doc_slug FROM pos FOR len)",
      "substring(r.doc_slug from '^\\((.*)$')",
      "trim(both ' ' from name)",
      "trim(leading from name)",
      "trim(from name)",
      "overlay(r.doc_slug placing 'x' from pos for len)",
      "substring(trim(both from name) from pos)",
      "position(needle in r.doc_slug)",
    ]) {
      expect(scan(`select ${expr} from li_source_registry r`), expr).toEqual([]);
    }

    // Control sample: the relation BEHIND each shape is still checked.
    for (const expr of [
      "extract(epoch from (select max(ts) from chybejici_tabulka))",
      "substring((select x from chybejici_tabulka) from '^a')",
      "trim(both from (select x from chybejici_tabulka))",
      "overlay(r.doc_slug placing (select x from chybejici_tabulka) from 1)",
      "position('x' in (select s from chybejici_tabulka))",
    ]) {
      expect(scan(`select ${expr} from li_source_registry r`), expr).toEqual(MISSING);
    }
    // A literal with parens must not skew depth and swallow what follows.
    expect(scan(`select substring(r.doc_slug from '\\)(') from chybejici_tabulka r`)).toEqual(MISSING);
    // A function whose name merely ENDS in trim is not the TRIM syntax.
    expect(scan(`select my_trim(x from chybejici_tabulka)`)).toEqual(MISSING);
  });
});
