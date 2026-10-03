#!/usr/bin/env node
/**
 * migrate-supabase-imports.mjs
 *
 * Bulk-rewrite @supabase/supabase-js imports to the v2 pure-HTTP API client.
 *
 * Transformations (safe, repeatable):
 *   1. `import { createClient, SupabaseClient } from "@supabase/supabase-js"`
 *      → removed; caller switches to `api` from `@/integrations/api/client`.
 *   2. `import type { RealtimeChannel } from "@supabase/supabase-js"`
 *      → `import type { RealtimeChannel } from "@/integrations/realtime/types"`.
 *   3. Comment-only mentions are LEFT ALONE (documentation).
 *
 * What the script does NOT do (still needs manual review):
 *   - Rewriting `createClient(...)` call sites to the new API (domain-specific).
 *   - Converting `.from(...).select(...)` to `api.rpc(...)`.
 *   - Uninstalling the package from package.json (do: `npm uninstall @supabase/supabase-js`).
 *
 * Run from repo root:
 *   node scripts/migrate-supabase-imports.mjs            # dry-run, prints planned changes
 *   node scripts/migrate-supabase-imports.mjs --apply    # actually rewrite files
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");

const SCAN_ROOTS = ["src", "scripts", "extensions", "plugins", "mobile-app", "services"];
const SKIP_PREFIXES = [
  "node_modules",
  "dist",
  "build",
  ".next",
  "archive",
  "playwright-report",
  "test-results",
  "coverage",
  ".turbo",
];
const ALLOWLIST = new Set([
  "src/tests/gates/supabase-removal.gate.test.ts",
  "src/tests/gates/service-security.gate.test.ts",
  "scripts/migrate-supabase-imports.mjs",
]);
const FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    // Directory unreadable (permissions, gone) — skip silently with logged context.
    console.warn(`[migrate-imports] skipping unreadable dir ${dir}:`, err.message);
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    if (SKIP_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      console.warn(`[migrate-imports] cannot stat ${full}:`, err.message);
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (FILE_EXT.test(entry)) yield full;
  }
}

/**
 * Rewrite a single source file.
 * Returns { changed, newSrc, notes[] }.
 */
function rewrite(src) {
  const notes = [];
  let out = src;

  // (1) type-only imports from @supabase/supabase-js — redirect to realtime types stub.
  out = out.replace(
    /import\s+type\s+\{\s*([^}]+?)\s*\}\s+from\s+["']@supabase\/supabase-js["'];?/g,
    (_m, names) => {
      notes.push(`type-import redirected: ${names.trim()}`);
      return `import type { ${names.trim()} } from "@/integrations/realtime/types";`;
    },
  );

  // (2) value imports from @supabase/supabase-js — comment them out; caller must migrate.
  out = out.replace(
    /^(\s*)(import\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*\{[^}]+\})?\s+from\s+["']@supabase\/supabase-js["'];?.*)$/gm,
    (_m, indent, stmt) => {
      notes.push(`value-import blocked: ${stmt.trim()}`);
      return `${indent}// TODO(v2-migration): replaced @supabase/supabase-js — use '@/integrations/api/client'.\n${indent}// ${stmt.trim()}`;
    },
  );

  // (3) bare side-effect imports
  out = out.replace(
    /^\s*import\s+["']@supabase\/supabase-js["'];?\s*$/gm,
    "// TODO(v2-migration): removed side-effect import of @supabase/supabase-js",
  );

  return { changed: out !== src, newSrc: out, notes };
}

function main() {
  let changed = 0;
  let planned = 0;
  const files = [];
  for (const root of SCAN_ROOTS) files.push(...walk(join(ROOT, root)));

  for (const f of files) {
    const rel = relative(ROOT, f);
    if (ALLOWLIST.has(rel)) continue;
    const src = readFileSync(f, "utf8");
    if (!/@supabase\/supabase-js/.test(src)) continue;
    const { changed: diff, newSrc, notes } = rewrite(src);
    if (!diff) continue;
    planned++;
    console.log(`${APPLY ? "[APPLY]" : "[DRY] "} ${rel}`);
    for (const n of notes) console.log(`        • ${n}`);
    if (APPLY) {
      writeFileSync(f, newSrc, "utf8");
      changed++;
    }
  }

  console.log("");
  console.log(
    APPLY
      ? `✅ Rewrote ${changed} file(s). Run 'npm run test:gates -- supabase-removal' to verify.`
      : `ℹ️  ${planned} file(s) would be rewritten. Re-run with --apply to commit changes.`,
  );
  console.log("");
  console.log("Next steps after --apply:");
  console.log("  1. Create src/integrations/realtime/types.ts with minimal type stubs if missing.");
  console.log("  2. Manually migrate createClient() call sites to api client.");
  console.log("  3. npm uninstall @supabase/supabase-js");
  console.log("  4. npm run test:gates -- supabase-removal");
}

main();
