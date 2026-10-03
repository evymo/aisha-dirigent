/**
 * SQL Baseline Double-Schema-Qualifier Gate
 *
 * PostgreSQL parses a three-part identifier `a.b.c` as
 * `database.schema.relation`. Cross-database references are not implemented
 * in PostgreSQL → any such reference throws:
 *
 *   ERROR: cross-database references are not implemented: "public.public.foo"
 *
 * Real-world incident (2026-05-20): cheers staging deploys failed silently for
 * multiple rounds with this error at `baseline.sql:1473`:
 *
 *   CREATE SEQUENCE IF NOT EXISTS public.public.workflow_status_transitions_id_seq;
 *
 * Root cause: the baseline generator (`scripts/db/generate-init-migration-
 * from-sources.mjs`) auto-detects sequences from `nextval('<X>'::regclass)`
 * matches and emits `CREATE SEQUENCE … public.<X>;`. Source SQL files write
 * either the qualified (`nextval('public.foo'::regclass)`) or unqualified
 * (`nextval('foo'::regclass)`) form. When the captured `<X>` was already
 * `public.foo`, the generator double-prefixed → `public.public.foo`.
 *
 * The generator was hardened to strip a leading `public.` before re-prefixing.
 * This gate prevents the silent reappearance — anywhere in the generated
 * baseline OR any migration shipped on disk.
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();

// Look for `<schema>.<schema>.<relation>` where both schema parts are bare
// identifiers (not quoted, no whitespace). Comments are stripped before
// scanning so an explanatory note like `-- e.g. public.public.foo` doesn't
// trip the gate.
const DOUBLE_SCHEMA_RE = /\b([a-z_][a-z0-9_]*)\.\1\.[a-z_][a-z0-9_]*\b/gi;

interface Hit {
  file: string;
  line: number;
  match: string;
}

function stripSqlComments(line: string): string {
  // strip `-- ...` to EOL. Block comments `/* */` are rare in migrations and
  // skipped here for simplicity; if they appear and contain `public.public.`
  // legitimately (very unlikely) we can refine later.
  const idx = line.indexOf("--");
  return idx >= 0 ? line.slice(0, idx) : line;
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => full.endsWith(ext))) out.push(full);
  }
  return out;
}

function scan(filePath: string): Hit[] {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripSqlComments(lines[i]);
    const matches = stripped.matchAll(DOUBLE_SCHEMA_RE);
    for (const m of matches) {
      hits.push({ file: filePath, line: i + 1, match: m[0] });
    }
  }
  return hits;
}

describe("SQL baseline double-schema-qualifier gate", () => {
  test("no `<schema>.<schema>.<relation>` patterns in baseline.sql or migrations", () => {
    const targets: string[] = [];
    const baseline = resolve(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");
    if (existsSync(baseline)) targets.push(baseline);
    // Also scan all other migrations + SoT SQL files
    targets.push(...walk(resolve(ROOT, "aisha/db/sql"), [".sql"]));
    targets.push(...walk(resolve(ROOT, "aisha/db/migrations"), [".sql"]));

    const allHits: Hit[] = [];
    for (const f of targets) {
      allHits.push(...scan(f));
    }

    if (allHits.length > 0) {
      const lines = allHits.map(
        (h) => `  ${h.file.replace(ROOT + "/", "")}:${h.line}: ${h.match}`,
      );
      throw new Error(
        `Found ${allHits.length} double-schema-qualifier pattern(s) (PostgreSQL parses these as "database.schema.relation" and rejects them with "cross-database references not implemented"):\n${lines.join("\n")}\n\nFix the source SoT file to use either qualified or unqualified form consistently, then regenerate baseline (\`npm run db:init:generate\`).`,
      );
    }
    expect(allHits.length).toBe(0);
  });
});
