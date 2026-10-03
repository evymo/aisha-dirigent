/**
 * Gate (remediation D1): no blanket anon SELECT in the cold-start grant restorer.
 *
 * CONTRACT: aisha/db/sql/grants/fix_missing_table_grants.sql must NOT hand the
 * unauthenticated `anon` role SELECT on tables *by default* or *in bulk*:
 *
 *   1. It must NOT set a schema-wide default privilege that auto-grants SELECT
 *      to anon on every future table:
 *          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
 *      That means any table created later is silently readable by the world.
 *
 *   2. It must NOT loop over pg_tables and GRANT SELECT to anon on all-but-N
 *      tables (the `NOT LIKE 'audience%' AND NOT IN (...)` blanket loop). A
 *      "grant to everything except a hardcoded deny-list" is the inverse of
 *      least privilege: every NEW PII-bearing table is anon-readable until
 *      someone remembers to add it to the exclusion list, and the cold-start
 *      loop silently RE-GRANTs anon SELECT after the per-object grant files,
 *      re-introducing any leak that was hardened out.
 *
 * The correct (post-fix) shape: anon-readable tables come from an EXPLICIT
 * allowlist (default-deny). Per-object anon SELECT grants for genuinely public
 * relations live in the reviewed per-object grant files under
 * aisha/db/sql/grants/, gated by the sibling anon-grants-select-only gate.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd): BOTH
 * anti-patterns are present in fix_missing_table_grants.sql — the
 * ALTER DEFAULT PRIVILEGES ... TO anon statement and the all-but-N pg_tables
 * loop. This is the known-OPEN "anon blanket-grant" item.
 *
 * After the fix (drop the default-privilege-to-anon statement and replace the
 * all-but-N loop with an explicit allowlist FOREACH) this gate goes green.
 * Do NOT weaken the assertions — fix the SQL.
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const GRANTS_DIR = join(ROOT, "aisha", "db", "sql", "grants");
const TARGET = join(GRANTS_DIR, "fix_missing_table_grants.sql");

/** Strip `--` line comments and /* *\/ block comments so a commented-out
 * statement never counts as a live grant. */
function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Collapse all runs of whitespace to single spaces for line-agnostic matching. */
function flatten(src: string): string {
  return src.replace(/\s+/g, " ").trim();
}

describe("D1: no blanket anon SELECT in fix_missing_table_grants.sql", () => {
  test("the target SQL file exists", () => {
    expect(
      existsSync(TARGET),
      `expected grant restorer at ${TARGET.slice(ROOT.length + 1)}`,
    ).toBe(true);
  });

  const raw = existsSync(TARGET) ? readFileSync(TARGET, "utf-8") : "";
  const live = flatten(stripSqlComments(raw));

  test("no schema-wide default privilege grants SELECT on TABLES to anon", () => {
    // ALTER DEFAULT PRIVILEGES [IN SCHEMA public] GRANT SELECT [, ...] ON TABLES TO ... anon ...
    const re =
      /ALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*\bGRANT\b[^;]*\bSELECT\b[^;]*\bON\s+TABLES\b[^;]*\bTO\b[^;]*\banon\b/i;
    const offending = re.exec(live);
    expect(
      offending,
      "fix_missing_table_grants.sql sets an ALTER DEFAULT PRIVILEGES ... GRANT " +
        "SELECT ON TABLES TO anon — every future public table becomes anon-readable " +
        "by default. Remove it; anon SELECT must be granted per-object from an " +
        `explicit allowlist. Matched: ${offending ? offending[0] : ""}`,
    ).toBeNull();
  });

  test("no all-tables loop GRANTs SELECT to anon over all-but-N tables", () => {
    // Anti-pattern: a DO/LOOP body that iterates pg_tables (schemaname='public')
    // and executes GRANT SELECT ... TO anon under a NOT LIKE / NOT IN exclusion.
    // Detect the two co-located ingredients on the live (comment-stripped) SQL:
    //  (a) a GRANT SELECT ... TO anon issued via EXECUTE format over a loop var, and
    //  (b) an exclusion predicate (NOT LIKE / NOT IN) — i.e. "all but N".
    const grantsSelectToAnonInLoop =
      /EXECUTE\s+format\(\s*['"`]GRANT\s+SELECT\s+ON[^'"`]*['"`][^)]*\)\s*[^;]*\bTO\s+anon\b/i.test(
        live,
      ) ||
      // also match format string that already embeds "TO anon" inside the quotes
      /EXECUTE\s+format\(\s*['"`]GRANT\s+SELECT\s+ON[^'"`]*\bTO\s+anon\b[^'"`]*['"`]/i.test(
        live,
      );

    const iteratesAllPublicTables =
      /FROM\s+pg_tables\b[^;]*\bWHERE\b[^;]*schemaname\s*=\s*'public'/i.test(live);

    const hasExclusionPredicate =
      /\bNOT\s+LIKE\b/i.test(live) || /\bNOT\s+IN\s*\(/i.test(live);

    const blanketAnonLoop =
      grantsSelectToAnonInLoop && iteratesAllPublicTables && hasExclusionPredicate;

    expect(
      blanketAnonLoop,
      "fix_missing_table_grants.sql loops over all public tables (pg_tables) and " +
        "GRANTs SELECT to anon on all-but-N tables via a NOT LIKE/NOT IN deny-list. " +
        "This is default-allow: every new PII table is anon-readable until excluded, " +
        "and the loop re-grants anon SELECT after per-object grants on every cold-start. " +
        "Replace the all-but-N loop with an EXPLICIT allowlist (default-deny).",
    ).toBe(false);
  });
});
