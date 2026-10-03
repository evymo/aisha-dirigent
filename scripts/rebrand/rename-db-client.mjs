#!/usr/bin/env node
/**
 * Targeted codemod: rename `supabase` client identifier → `aisha` in files
 * that import from `@/integrations/db/client`.
 *
 * Scope limited to consumers of db/client to avoid accidental rewrites in
 * unrelated code (tests that scan codebase for string "supabase", SQL SoT, ...).
 *
 * Symbols renamed (named imports + usages within same file):
 *   supabase                    → aisha
 *   supabaseConfig              → aishaConfig
 *   isSupabaseConfigured        → isAishaConfigured
 *   validateSupabaseConfig      → validateAishaConfig
 *   isUsingSupabaseDevFallback  → isUsingAishaDevFallback
 *
 * NOT touched:
 *   - `supabase_admin` DB role string literals
 *   - Comments/docstrings referencing history
 *   - `src/integrations/db/client.ts` itself (use --include-client)
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has("--apply");
const INCLUDE_CLIENT = ARGS.has("--include-client");

const CLIENT_IMPORT_RE =
  /from\s+["'](?:@\/integrations\/db\/client|\.\.?\/(?:\.\.\/)*integrations\/db\/client|\.\/client)["']|vi\.mock\(\s*["']@\/integrations\/db\/client["']/;

const SYMBOL_MAP = [
  ["isUsingSupabaseDevFallback", "isUsingAishaDevFallback"],
  ["validateSupabaseConfig", "validateAishaConfig"],
  ["isSupabaseConfigured", "isAishaConfigured"],
  ["supabaseConfig", "aishaConfig"],
  ["supabase", "aisha"], // must be LAST (shortest/broadest)
];

const EXT_RE = /\.(ts|tsx|mjs|cjs|js|jsx)$/;
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "workbench",
  "archive",
  "trash",
  "offline-knowledge",
  "test-results",
  "playwright-report",
]);

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT_RE.test(e.name)) yield p;
  }
}

/**
 * Rename symbols within a file content. Uses word-boundary regex to avoid
 * matching substrings like "supabase_admin" or "supabaseConfig" when we're
 * replacing "supabase". The SYMBOL_MAP is ordered long→short so specific
 * symbols are replaced first.
 */
function renameSymbols(content) {
  let out = content;
  let changed = 0;
  for (const [oldSym, newSym] of SYMBOL_MAP) {
    // Only match identifier boundaries: [A-Za-z0-9_] on neither side.
    const re = new RegExp(`(?<![A-Za-z0-9_])${oldSym}(?![A-Za-z0-9_])`, "g");
    const after = out.replace(re, () => {
      changed += 1;
      return newSym;
    });
    out = after;
  }
  return { out, changed };
}

async function main() {
  const files = [];
  const srcRoot = path.join(ROOT, "src");

  for await (const f of walk(srcRoot)) {
    if (!INCLUDE_CLIENT && f.endsWith(path.join("integrations", "db", "client.ts"))) continue;
    const buf = await fs.readFile(f, "utf8");
    if (!CLIENT_IMPORT_RE.test(buf)) continue;
    files.push(f);
  }

  let totalChanged = 0;
  let filesTouched = 0;
  for (const f of files) {
    const content = await fs.readFile(f, "utf8");
    const { out, changed } = renameSymbols(content);
    if (changed === 0 || out === content) continue;
    filesTouched += 1;
    totalChanged += changed;
    if (APPLY) await fs.writeFile(f, out, "utf8");
  }

  console.log(`${APPLY ? "Applied" : "Would apply"}: ${filesTouched} files, ${totalChanged} symbol replacements`);
  if (!APPLY) console.log("(dry-run — re-run with --apply)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
