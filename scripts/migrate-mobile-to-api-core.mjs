#!/usr/bin/env node
/**
 * Bulk migration: mobile-app supabase-client → @aisha/api-core.
 *
 * Rewrites in-place across mobile-app/src/{hooks,app,...}:
 *   import { supabase } from "@/config/supabase"
 *     → import { api, realtime } from "@/config/api"
 *   supabase.rpc(             → api.rpc(
 *   supabase.functions.invoke( → api.invoke(
 *   supabase.channel(         → realtime.channel(
 *   supabase.removeChannel(   → realtime.removeChannel(
 *   from "@supabase/supabase-js" (type-only)
 *     → from "@aisha/api-core"
 *
 * Usage:
 *   node scripts/migrate-mobile-to-api-core.mjs           # dry-run
 *   node scripts/migrate-mobile-to-api-core.mjs --apply   # commit
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "mobile-app", "src");
const APPLY = process.argv.includes("--apply");

/** @type {{from: RegExp, to: string, label: string}[]} */
const REWRITES = [
  {
    from: /from\s+["']@\/config\/supabase["']/g,
    to: 'from "@/config/api"',
    label: "import path",
  },
  {
    from: /import\s*{\s*supabase\s*}\s*from\s*["']@\/config\/api["']/g,
    to: 'import { api, realtime } from "@/config/api"',
    label: "named import",
  },
  { from: /\bsupabase\.functions\.invoke\(/g, to: "api.invoke(", label: "functions.invoke" },
  { from: /\bsupabase(\s*\n?\s*)\.rpc\(/g, to: "api$1.rpc(", label: "rpc" },
  { from: /\bsupabase(\s*\n?\s*)\.channel\(/g, to: "realtime$1.channel(", label: "channel" },
  {
    from: /\bsupabase(\s*\n?\s*)\.removeChannel\(/g,
    to: "realtime$1.removeChannel(",
    label: "removeChannel",
  },
  {
    from: /from\s+["']@supabase\/supabase-js["']/g,
    to: 'from "@aisha/api-core"',
    label: "type import",
  },
];

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__generated__") continue;
      yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      yield p;
    }
  }
}

let touched = 0;
const allChanges = [];

for await (const file of walk(ROOT)) {
  // Skip the new replacement file itself and anything left in legacy supabase.ts
  const rel = path.relative(process.cwd(), file);
  if (/config\/(api|supabase)\.ts$/.test(rel)) continue;

  const original = await fs.readFile(file, "utf8");
  let next = original;
  const hits = [];

  for (const r of REWRITES) {
    const before = next;
    next = next.replace(r.from, r.to);
    if (before !== next) hits.push(r.label);
  }

  if (next !== original) {
    touched += 1;
    allChanges.push({ file: rel, hits });
    if (APPLY) await fs.writeFile(file, next, "utf8");
  }
}

console.log(`${APPLY ? "Applied" : "Planned"} ${touched} file change(s).`);
for (const c of allChanges) {
  console.log(`  ${c.file}  [${c.hits.join(", ")}]`);
}
if (!APPLY) console.log("Run with --apply to commit.");
