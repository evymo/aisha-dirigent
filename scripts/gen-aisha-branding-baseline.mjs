#!/usr/bin/env node
/**
 * Generate aisha-branding.baseline.json for `aisha-branding.gate.test.ts`.
 *
 * Walks the repo (same skip rules as the gate), counts case-insensitive
 * `supabase` occurrences per file, and writes the snapshot. The gate enforces
 * that no NEW file appears and no existing file's count GROWS.
 *
 * Run: `node scripts/gen-aisha-branding-baseline.mjs`
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { porovnej } from "./lib/razeni.mjs";

const PROJECT_ROOT = process.cwd();
const __filename = fileURLToPath(import.meta.url);
const BASELINE_PATH = join(PROJECT_ROOT, "src/tests/gates/aisha-branding.baseline.json");

const FILE_EXT = /\.(ya?ml|sh|ts|tsx|js|jsx|mjs|cjs|json)$/;
const ENV_FILE = /(^|\/)\.env(\.|$)/;

const SKIP_DIR_PARTS = new Set([
  "node_modules",
  ".git",
  ".claude", // worktree clones, claude tooling — never source of truth
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "playwright-report",
  "test-results",
  "archive",
  "trash",
  ".aisha",
  "supabase",
  "workbench",
  "offline-knowledge",
  "playwright-report",
  "knowledge-extraction",
]);

// MUST match ALLOWLIST in src/tests/gates/aisha-branding.gate.test.ts.
// RULE: pouze gate trackers + migration tooling. Žádný "bypass" entries.
const ALLOWLIST = new Set([
  "src/tests/gates/aisha-branding.gate.test.ts",
  "src/tests/gates/aisha-branding.baseline.json",
  "src/tests/gates/supabase-removal.gate.test.ts",
  "src/tests/gates/service-security.gate.test.ts",
  "src/tests/gates/deprecated-stack-refs.gate.test.ts",
  "scripts/migrate-supabase-imports.mjs",
  "scripts/gen-aisha-branding-baseline.mjs",
]);

const PATTERN = /supabase/gi;

function shouldSkip(rel) {
  return rel.split("/").some((p) => SKIP_DIR_PARTS.has(p));
}
function isScannable(rel) {
  return FILE_EXT.test(rel) || ENV_FILE.test(rel);
}
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.warn(`walk: nelze přečíst ${dir}: ${err.message}`);
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relative(PROJECT_ROOT, full);
    if (shouldSkip(rel)) continue;
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      console.warn(`stat: nelze najít ${rel}: ${err.message}`);
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (isScannable(rel)) out.push(rel);
  }
}

const files = [];
walk(PROJECT_ROOT, files);

const counts = {};
let totalOccurrences = 0;
for (const file of files) {
  if (ALLOWLIST.has(file)) continue;
  let src;
  try {
    src = readFileSync(join(PROJECT_ROOT, file), "utf8");
  } catch (err) {
    console.warn(`read: nelze přečíst ${file}: ${err.message}`);
    continue;
  }
  const m = src.match(PATTERN);
  if (!m) continue;
  counts[file] = m.length;
  totalOccurrences += m.length;
}

const sortedFiles = Object.fromEntries(
  Object.entries(counts).sort(([a], [b]) => porovnej(a, b)),
);

const out = {
  generated_at: new Date().toISOString(),
  total_files: Object.keys(sortedFiles).length,
  total_occurrences: totalOccurrences,
  files: sortedFiles,
};

writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(
  `✓ Wrote baseline: ${out.total_files} files, ${out.total_occurrences} occurrences → ${relative(PROJECT_ROOT, BASELINE_PATH)}`,
);
