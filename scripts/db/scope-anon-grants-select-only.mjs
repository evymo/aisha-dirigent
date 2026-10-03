#!/usr/bin/env node
/*
 * Least-privilege normalizer for anon table grants (SoT).
 *
 * Background
 * ----------
 * The per-object grant files in `aisha/db/sql/grants/` were originally produced
 * by a pg_dump-style extraction that emitted a UNIFORM 7-privilege grant
 *   GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ... TO anon;
 * to anon/authenticated/service_role alike. For the `anon` (unauthenticated)
 * role this is a least-privilege violation and a defense-in-depth gap:
 *   - INSERT/UPDATE/DELETE are gated by RLS, but
 *   - TRUNCATE / REFERENCES / TRIGGER are NOT gated by RLS — anon holding them
 *     can wipe or alter tables regardless of row policies.
 *
 * RLS cross-check (see docs): every write policy that applies to anon/public is
 * gated on auth.uid() / is_admin_or_staff() / owner / service_role / check(false),
 * none of which the anon role (auth.uid() = NULL) can satisfy. There is NO
 * legitimate anon WRITE path. anon SELECT-only is the correct floor and is what
 * `fix_missing_table_grants.sql`'s cold-start DO-loop already grants.
 *
 * What this does (idempotent)
 * ---------------------------
 *  1. In every `grants/*.sql`, rewrite any `GRANT <privs> ON <obj> TO anon;`
 *     whose privilege set is broader than SELECT  →  `GRANT SELECT ON <obj> TO anon;`
 *  2. In `fix_missing_table_grants.sql`, scope the ALTER DEFAULT PRIVILEGES anon
 *     grant down to SELECT (future tables).
 *  3. Leaves `authenticated` and `service_role` grants untouched.
 *  4. Leaves `GRANT EXECUTE ON FUNCTION ... TO anon` (public RPCs) untouched.
 *  5. Excludes already-correct tables: branding_profiles, branding_hostname_mapping,
 *     web_pages (defensive — they have no broad grant file anyway).
 *
 * After running: regenerate the baseline (never hand-edit it):
 *   node scripts/db/generate-init-migration-from-sources.mjs
 */

import fs from "fs";
import path from "path";

const repoRoot = process.cwd();
const grantsDir = path.resolve(repoRoot, "aisha/db/sql/grants");

const EXCLUDE_TABLES = new Set([
  "branding_profiles",
  "branding_hostname_mapping",
  "web_pages",
]);

// GRANT <privs> ON <object> TO anon ;   (single line; object may be public.x or x)
const ANON_TABLE_GRANT =
  /^(\s*)GRANT\s+([A-Z, ]+?)\s+ON\s+((?!FUNCTION\b)[^\n;]+?)\s+TO\s+anon\s*;\s*$/i;

function normalizePrivs(privs) {
  return privs
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

function objectBareName(obj) {
  const noSchema = obj.includes(".") ? obj.split(".").pop() : obj;
  return noSchema.replace(/"/g, "").trim().toLowerCase();
}

let filesChanged = 0;
let linesChanged = 0;

for (const name of fs.readdirSync(grantsDir).filter((f) => f.endsWith(".sql"))) {
  const filePath = path.join(grantsDir, name);
  const src = fs.readFileSync(filePath, "utf8");
  const lines = src.split("\n");
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ANON_TABLE_GRANT);
    if (!m) continue;

    const [, indent, privs, obj] = m;
    if (privs.toUpperCase().includes("EXECUTE")) continue; // function grant
    if (EXCLUDE_TABLES.has(objectBareName(obj))) continue;
    if (normalizePrivs(privs) === "SELECT") continue; // already correct

    lines[i] = `${indent}GRANT SELECT ON ${obj} TO anon;`;
    changed = true;
    linesChanged++;
  }

  // Special case: ALTER DEFAULT PRIVILEGES ... GRANT <writes> ON TABLES TO anon;
  // (spans two lines in fix_missing_table_grants.sql)
  if (name === "fix_missing_table_grants.sql") {
    const joined = lines.join("\n");
    const fixed = joined.replace(
      /(ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+public\s+GRANT\s+)[A-Z, ]+?(\s+ON\s+TABLES\s+TO\s+anon\s*;)/i,
      (full, head, tail) => {
        if (/^\s*SELECT\s*$/i.test(full.replace(head, "").replace(tail, ""))) return full;
        linesChanged++;
        return `${head}SELECT${tail}`;
      },
    );
    if (fixed !== joined) {
      fs.writeFileSync(filePath, fixed, "utf8");
      filesChanged++;
      continue;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
    filesChanged++;
  }
}

console.log(`anon grant scope-down complete: ${linesChanged} line(s) across ${filesChanged} file(s) reduced to SELECT.`);
