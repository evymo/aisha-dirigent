/**
 * SQL Table Duplicate-Columns Gate
 *
 * PostgreSQL rejects a CREATE TABLE that lists the same column name twice:
 *
 *   ERROR: column "contextual_prefix" specified more than once
 *
 * Real-world incident (2026-05-20): cheers staging baseline apply crashed on
 * line 4247 of the generated baseline.sql because the source SoT files
 * knowledge_chunks.sql, knowledge_embeddings.sql, knowledge_items.sql each
 * had the new column block from their respective ALTER-TABLE migration
 * PASTED IN TWICE — once with a brief comment, once with the longer comment
 * from the migration file. Diff merge artifact during the 2026-05-19
 * upstream sync, surviving because SQL still parses outside CREATE TABLE
 * context (e.g. ALTER ADD COLUMN with IF NOT EXISTS would silently no-op)
 * but inside CREATE TABLE it's a parse-time error.
 *
 * This gate scans every CREATE TABLE body in aisha/db/sql/tables/ for
 * duplicate column names. The same source files feed the baseline generator,
 * so catching duplicates here prevents the baseline from ever shipping with
 * the bug.
 *
 * Spousti se pres: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const TABLES_DIR = resolve(ROOT, "aisha/db/sql/tables");

interface Hit {
  file: string;
  duplicates: Record<string, number>;
}

// Extract column names from a CREATE TABLE body. Skips constraints + comments.
// Splits on top-level commas (parens-aware) so multi-line CHECK constraints
// don't confuse the parser.
function getColumns(sqlText: string): string[] {
  const m = sqlText.match(/CREATE TABLE[^(]*\(([\s\S]*?)\)\s*;/i);
  if (!m) return [];
  // Strip line comments BEFORE splitting on commas — the order matters and
  // getting it wrong produced false positives (measured 2026-07-26: a comment
  // reading "...the spec IS the contract, config_schema stays the" was split at
  // its comma, and the orphaned tail " config_schema stays the" no longer began
  // with `--`, so the per-item comment strip missed it and the column regex
  // matched it as a second `config_schema` declaration). PostgreSQL lexes
  // comments away first; so must we.
  const body = m[1].replace(/--.*$/gm, "");
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      items.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur.trim());

  const cols: string[] = [];
  const CONSTRAINT_RE = /^(PRIMARY KEY|CONSTRAINT|UNIQUE|FOREIGN|CHECK)\b/i;
  const COL_RE = /^([a-z_][a-z0-9_]*)\s+/i;
  for (const raw of items) {
    const line = raw.replace(/^--.*$/gm, "").trim();
    if (!line) continue;
    if (CONSTRAINT_RE.test(line)) continue;
    const c = COL_RE.exec(line);
    if (c) cols.push(c[1]);
  }
  return cols;
}

describe("SQL table duplicate-columns gate", () => {
  test("no CREATE TABLE in aisha/db/sql/tables/ lists the same column twice", () => {
    if (!existsSync(TABLES_DIR)) {
      expect(true).toBe(true);
      return;
    }
    const hits: Hit[] = [];
    for (const f of readdirSync(TABLES_DIR)) {
      if (!f.endsWith(".sql")) continue;
      const fp = join(TABLES_DIR, f);
      const content = readFileSync(fp, "utf-8");
      const cols = getColumns(content);
      const seen: Record<string, number> = {};
      for (const c of cols) seen[c] = (seen[c] || 0) + 1;
      const dups: Record<string, number> = {};
      for (const [c, n] of Object.entries(seen)) {
        if (n > 1) dups[c] = n;
      }
      if (Object.keys(dups).length > 0) {
        hits.push({ file: fp, duplicates: dups });
      }
    }
    if (hits.length > 0) {
      const lines = hits.map(
        (h) =>
          "  " + h.file.replace(ROOT + "/", "") + ": " +
          Object.entries(h.duplicates).map(([c, n]) => c + "x" + n).join(", "),
      );
      throw new Error(
        "Found " + hits.length + " table(s) with duplicate column declarations - PostgreSQL rejects these at baseline apply:\n" +
        lines.join("\n") +
        "\n\nDeduplicate the column lines in the SoT file then regenerate baseline (npm run db:init:generate).",
      );
    }
    expect(hits.length).toBe(0);
  });
});
