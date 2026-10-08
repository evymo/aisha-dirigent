#!/usr/bin/env node
/*
 * Least-privilege normalizer for `authenticated` table grants (SoT).
 *
 * Background
 * ----------
 * The per-object grant files in `aisha/db/sql/grants/` came from a pg_dump-style
 * extraction that emitted a UNIFORM 7-privilege grant
 *   GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ... TO authenticated;
 * `scripts/db/scope-anon-grants-select-only.mjs` already scoped the `anon` side
 * down; `authenticated` kept all seven (measured 2026-10-08: 254 grant files).
 *
 * SELECT/INSERT/UPDATE/DELETE are RLS-gated and stay — the platform's RLS
 * policies are the row fence for signed-in users. TRUNCATE, REFERENCES and
 * TRIGGER are NOT subject to RLS:
 *   - TRUNCATE empties the whole table regardless of row policies,
 *   - TRIGGER lets the holder attach triggers to the table,
 *   - REFERENCES lets the holder point foreign keys at it.
 * No client path needs them: PostgREST never issues them, and the only SoT
 * functions that TRUNCATE are SECURITY DEFINER (run as the owner). The default
 * privileges for future tables (`fix_missing_table_grants.sql`) already grant
 * authenticated exactly SELECT, INSERT, UPDATE, DELETE — this aligns the
 * existing per-object grants with that floor.
 *
 * What this does (idempotent)
 * ---------------------------
 *  In every `grants/*.sql`, rewrite `GRANT <privs> ON <relation> TO authenticated;`
 *  to drop TRUNCATE, REFERENCES and TRIGGER from <privs>, keeping the rest in
 *  their original order. Function grants and multi-grantee lines are untouched
 *  (the gate `authenticated-grants-bez-ddl` catches any of those that is broad).
 *
 * After running: regenerate the baseline (never hand-edit it):
 *   npm run db:init:generate
 */
import fs from "node:fs";
import path from "node:path";

const NOT_RLS_GATED = new Set(["TRUNCATE", "REFERENCES", "TRIGGER"]);

const repoRoot = process.cwd();
const grantsDir = path.resolve(repoRoot, "aisha/db/sql/grants");

// GRANT <privs> ON <object> TO authenticated ;   (single line; object may be public.x or x)
const AUTH_TABLE_GRANT =
  /^(\s*)GRANT\s+([A-Z, ]+?)\s+ON\s+((?!FUNCTION\b)[^\n;]+?)\s+TO\s+authenticated\s*;\s*$/i;

let filesChanged = 0;
let linesChanged = 0;

for (const name of fs.readdirSync(grantsDir).filter((f) => f.endsWith(".sql"))) {
  const filePath = path.join(grantsDir, name);
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(AUTH_TABLE_GRANT);
    if (!m) continue;
    const [, indent, privs, obj] = m;
    const all = privs.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
    if (all.includes("EXECUTE")) continue; // function grant
    const kept = all.filter((p) => !NOT_RLS_GATED.has(p));
    if (kept.length === all.length) continue; // already scoped
    if (kept.length === 0) {
      throw new Error(`${name}: grant to authenticated would become empty: ${lines[i].trim()}`);
    }
    lines[i] = `${indent}GRANT ${kept.join(", ")} ON ${obj} TO authenticated;`;
    changed = true;
    linesChanged++;
  }

  if (changed) {
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
    filesChanged++;
  }
}

console.log(
  `authenticated grant scope-down complete: ${linesChanged} line(s) across ${filesChanged} file(s) — TRUNCATE/REFERENCES/TRIGGER removed.`,
);
