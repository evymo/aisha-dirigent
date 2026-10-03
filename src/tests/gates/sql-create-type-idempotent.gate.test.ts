/**
 * SQL CREATE TYPE Idempotent Gate
 *
 * PostgreSQL does NOT support `CREATE TYPE IF NOT EXISTS`. The clause is
 * silently accepted by some SQL editors as a "looks valid" pattern but
 * postgres throws `ERROR: syntax error at or near "NOT"` at execution.
 *
 * Real-world incident (2026-05-18): cheers staging deploy with
 * `AISHA_DB_FORCE_BASELINE_RESET=1` failed because
 * `aisha/db/sql/tables/aitg_test_catalog.sql` shipped with
 *
 *   CREATE TYPE IF NOT EXISTS aitg_layer AS ENUM (…);
 *
 * Baseline.sql is generated from sql/ source files. The broken SQL
 * landed in baseline → migrate.mjs failed at baseline apply →
 * AISHA_MIGRATE_DEBUG_HOLD=1 masked failure → containers booted on an
 * empty DB → silently broken for hours. The migration file that
 * INTRODUCED these types (20260516144654_aitg_baseline.sql) used the
 * correct idempotent pattern; the source file was retro-fitted with the
 * invalid syntax. This gate prevents the silent reappearance.
 *
 * Idempotent CREATE TYPE pattern that DOES work:
 *
 *   DO $$ BEGIN
 *     CREATE TYPE foo AS ENUM ('a', 'b');
 *   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();

// Pattern that postgres rejects. The trailing `\b` keeps us from
// flagging e.g. `CREATE TYPE IF NOT EXISTS_FOR_FUN` (hypothetical macro);
// `IF NOT EXISTS` is the full clause that doesn't exist for TYPE.
const INVALID_RE = /\bCREATE\s+TYPE\s+IF\s+NOT\s+EXISTS\b/i;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, ext: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, ext, out);
    } else if (entry.isFile() && ext.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function scan(file: string): Hit[] {
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip SQL line comments — they may legitimately reference the
    // anti-pattern in explanatory text (e.g. "do NOT use CREATE TYPE
    // IF NOT EXISTS — postgres rejects it").
    if (/^\s*--/.test(line)) continue;
    if (INVALID_RE.test(line)) {
      hits.push({
        file: file.slice(ROOT.length + 1),
        line: i + 1,
        text: line.trim().slice(0, 120),
      });
    }
  }
  return hits;
}

describe('SQL CREATE TYPE IF NOT EXISTS gate', () => {
  test('no SQL file uses `CREATE TYPE IF NOT EXISTS` (postgres does not support it)', () => {
    const dirs = [
      resolve(ROOT, 'aisha', 'db', 'sql'),
      resolve(ROOT, 'aisha', 'db', 'migrations'),
      resolve(ROOT, 'aisha', 'db', 'seed'),
      resolve(ROOT, 'aisha', 'db', 'seeds'),
    ];
    const sqlFiles: string[] = [];
    for (const d of dirs) walk(d, ['.sql'], sqlFiles);
    expect(sqlFiles.length, 'expected to find SQL files to scan').toBeGreaterThan(0);

    const hits: Hit[] = [];
    for (const f of sqlFiles) hits.push(...scan(f));

    if (hits.length === 0) {
       
      console.log(`[create-type-idempotent] scanned ${sqlFiles.length} SQL files, 0 violations`);
      return;
    }

    const report = hits
      .slice(0, 20)
      .map((h) => `  ${h.file}:${h.line}\n      ${h.text}`)
      .join('\n');
    const more = hits.length > 20 ? `\n  …and ${hits.length - 20} more.` : '';

    throw new Error(
      `Found ${hits.length} SQL location(s) using \`CREATE TYPE IF NOT EXISTS\` — postgres does not support this clause:\n\n${report}${more}\n\n` +
        `Fix: replace with the idempotent DO-block pattern\n` +
        `  DO $$ BEGIN\n` +
        `    CREATE TYPE name AS ENUM ('a', 'b');\n` +
        `  EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n\n` +
        `Reference: cheers staging incident 2026-05-18 — baseline.sql carried\n` +
        `this invalid SQL through baseline regeneration; deploy with\n` +
        `AISHA_DB_FORCE_BASELINE_RESET=1 failed; AISHA_MIGRATE_DEBUG_HOLD=1\n` +
        `masked the failure; entire stack booted on empty DB.`,
    );
  });
});
