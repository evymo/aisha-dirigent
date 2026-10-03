#!/usr/bin/env node
/**
 * PRODUCTION reverse direction: dump DB content translations back into the file
 * Source of Truth (src/i18n/content/{locale}/{namespace}.json).
 *
 * Two complementary directions for the SAME content namespaces:
 *   • build-content-translations.mjs  — files → DB seed   (v0 / base-seed init)
 *   • dump-content-translations.mjs   — DB    → files     (capture prod edits)
 *
 * Why both: at v0 the files are the base seed we install FROM. In production the
 * DB is edited by admins/users (translation fixes & improvements), so we
 * periodically dump the live DB back into the file SoT, commit it, and the next
 * deploy's base seed carries those improvements — i.e. we never lose user data.
 * (This formalises the legacy "-- Auto-generated from database" export that the
 * file-SoT refactor replaced.)
 *
 * Which namespaces: the content set already present under src/i18n/content/
 * (one .json per namespace), or an explicit --namespaces=a,b,c. The static app
 * i18n (src/i18n/segments → locales) and the `web` namespace are NOT touched.
 *
 * Usage:
 *   node scripts/i18n/dump-content-translations.mjs --local
 *   AISHA_DB_URL=… node scripts/i18n/dump-content-translations.mjs
 *   node scripts/i18n/dump-content-translations.mjs --namespaces=hero,products
 *
 * After dumping: run `npm run i18n:content:build` to regenerate the seed SQL and
 * `git diff` to review the captured changes.
 *
 * @module
 */
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { psqlPripojeni } from "../db/lib/psql-pripojeni.mjs";
import { rowsToTree, stringifyNamespace, SUPPORTED_LOCALES } from "./lib/content-translations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIR = path.join(ROOT, "src", "i18n", "content");

const isLocal = process.argv.includes("--local");
const nsArg = process.argv.find((a) => a.startsWith("--namespaces="));

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const dbUrl = isLocal ? LOCAL_DB_URL : process.env.AISHA_DB_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("❌ AISHA_DB_URL or DATABASE_URL required (or use --local)");
  process.exit(2);
}

// Content namespaces = explicit list, else the set already under src/i18n/content/.
let namespaces;
if (nsArg) {
  namespaces = nsArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean);
} else {
  const set = new Set();
  for (const loc of SUPPORTED_LOCALES) {
    const d = path.join(CONTENT_DIR, loc);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith(".json")) set.add(f.replace(/\.json$/, ""));
  }
  namespaces = [...set].sort();
}
if (!namespaces.length) {
  console.error("❌ No content namespaces found (src/i18n/content/ empty and no --namespaces=)");
  process.exit(2);
}
// Identifiers only — safe to inline in SQL.
for (const ns of namespaces)
  if (!/^[a-z0-9_]+$/i.test(ns)) {
    console.error(`❌ Unsafe namespace name: ${ns}`);
    process.exit(2);
  }

console.log(`\n📥 Dumping DB content translations → src/i18n/content/`);
console.log(`   namespaces: ${namespaces.join(", ")}\n`);

const inList = namespaces.map((n) => `'${n}'`).join(", ");
const sql =
  `SELECT coalesce(json_agg(json_build_object(` +
  `'key', key, 'locale', locale, 'namespace', namespace, 'value', value)), '[]'::json) ` +
  `FROM translations WHERE namespace IN (${inList});`;

let out;
try {
  // Heslo prostředím, ne v argv — `err.message` níž by ho jinak vypsal.
  const { cil, env } = psqlPripojeni(dbUrl, { ...process.env, PGOPTIONS: "--client-min-messages=warning" });
  out = execFileSync("psql", [cil, "-tAX", "-c", sql], {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
    env,
  });
} catch (err) {
  console.error("❌ DB query failed:", err.message);
  process.exit(1);
}

const rows = JSON.parse(out.trim() || "[]");
if (!rows.length) {
  console.error("❌ Query returned 0 rows — wrong DB or namespaces not seeded?");
  process.exit(1);
}

const tree = rowsToTree(rows);
let files = 0;
for (const loc of Object.keys(tree).sort()) {
  const locDir = path.join(CONTENT_DIR, loc);
  mkdirSync(locDir, { recursive: true });
  for (const ns of Object.keys(tree[loc]).sort()) {
    writeFileSync(path.join(locDir, `${ns}.json`), stringifyNamespace(tree[loc][ns]));
    files++;
  }
}

console.log(`✅ Dumped ${rows.length} rows → ${files} content SoT file(s).`);
console.log(`   Next: \`npm run i18n:content:build\` then \`git diff\` to review.\n`);
