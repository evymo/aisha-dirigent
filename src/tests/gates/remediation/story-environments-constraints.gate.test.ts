/**
 * D3 — story_environments enum-column CHECK constraints gate (remediation, test-first)
 *
 * CONTRACT:
 *   aisha/db/sql/tables/story_environments.sql defines a table whose
 *   `environment`, `deploy_provider`, and `deploy_status` columns model a
 *   FIXED, KNOWN vocabulary (dev/staging/prod; coolify/…; pending/success/…).
 *   These are enum-shaped columns and MUST be constrained by a
 *   `CHECK (<col> IN (...))` constraint (inline column CHECK, table-level
 *   CHECK, or a separate `ALTER TABLE ... ADD CONSTRAINT ... CHECK`), so the
 *   DB rejects free-text garbage at the boundary (Validate-All-Input +
 *   fail-loud). A plain `text NOT NULL` column accepts any string, silently
 *   admitting typos / unknown providers / bogus statuses.
 *
 * KNOWN-RED (at authoring, HEAD 569c5ffd):
 *   All three columns are declared as bare `text` (NOT NULL / DEFAULT) with
 *   NO CHECK constraint anywhere in the file. The gate flags all three.
 *
 * Post-fix: add `CHECK (<col> IN (...))` for each of the three columns
 *   (inline or via ALTER TABLE) → gate GREEN.
 *
 * SCOPE: this is a single-file contract (one canonical SoT table file), but the
 *   check is written column-class-wise so every constrained-vocabulary column
 *   is asserted independently and any newly-added enum column that regresses to
 *   free text is caught by extending CONSTRAINED_COLUMNS.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

const SQL_FILE = path.join(
  ROOT,
  "aisha",
  "db",
  "sql",
  "tables",
  "story_environments.sql",
);

/**
 * Columns whose domain is a fixed, known vocabulary and therefore MUST be
 * constrained by a CHECK (... IN (...)) constraint rather than accepting free
 * text. Extend this list when new enum-shaped columns are added to the table.
 */
const CONSTRAINED_COLUMNS: ReadonlyArray<string> = [
  "environment",
  "deploy_provider",
  "deploy_status",
];

function readSql(): string {
  expect(fs.existsSync(SQL_FILE), `SoT table file missing: ${SQL_FILE}`).toBe(true);
  return fs.readFileSync(SQL_FILE, "utf-8");
}

/**
 * Returns true if the SQL text contains a CHECK constraint whose predicate
 * references `column` together with an `IN (...)` list. Matches all three
 * common shapes:
 *   - inline column CHECK:      environment text NOT NULL CHECK (environment IN ('dev',...))
 *   - table-level CHECK:        CHECK (environment IN (...))
 *   - separate ALTER TABLE:     ALTER TABLE ... ADD CONSTRAINT ... CHECK (environment IN (...))
 *
 * The regex is intentionally permissive about whitespace/casing and about an
 * optional `public.`/table qualifier or type cast, but REQUIRES both the
 * `CHECK` keyword, the target column, and an `IN (` membership list so a bare
 * `text NOT NULL` column can never satisfy it.
 */
function hasCheckInConstraint(sql: string, column: string): boolean {
  const col = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // CHECK ( ... <col> ... IN ( ... ) ... )
  const re = new RegExp(
    "\\bCHECK\\b[^;]*?\\b" + col + "\\b[^;]*?\\bIN\\s*\\(",
    "is",
  );
  return re.test(sql);
}

describe("D3 story_environments enum-column CHECK constraints gate", () => {
  it("SoT table file exists and declares the table (sanity)", () => {
    const sql = readSql();
    expect(/CREATE TABLE[\s\S]*story_environments/i.test(sql)).toBe(true);
  });

  for (const column of CONSTRAINED_COLUMNS) {
    it(`column "${column}" is constrained by a CHECK (... IN (...)) constraint`, () => {
      const sql = readSql();
      expect(
        hasCheckInConstraint(sql, column),
        `story_environments.${column} has no CHECK (${column} IN (...)) constraint. ` +
          `It models a fixed vocabulary and must not be free text — add a CHECK ` +
          `constraint (inline or via ALTER TABLE ... ADD CONSTRAINT) enumerating ` +
          `the allowed values so the DB rejects unknown input at the boundary. ` +
          `File: ${path.relative(ROOT, SQL_FILE)}`,
      ).toBe(true);
    });
  }
});
