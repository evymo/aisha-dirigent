#!/usr/bin/env node
/**
 * SQL Function Lister
 *
 * Lists all SQL functions from aisha/db/sql/functions/ source of truth.
 * Optionally queries live DB for function status.
 *
 * Usage:
 *   node scripts/db/func-list.mjs           # List from source files
 *   node scripts/db/func-list.mjs --live     # Compare with live local DB
 *
 * @module
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { porovnej } from "../lib/razeni.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FUNCTIONS_DIR = path.join(ROOT, "aisha", "db", "sql", "functions");

const isLive = process.argv.includes("--live");

if (!existsSync(FUNCTIONS_DIR)) {
  console.error(`❌ Functions directory not found: ${FUNCTIONS_DIR}`);
  process.exit(1);
}

const files = readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith(".sql"));

console.log(`\n📋 SQL Functions (${files.length} source files)\n`);

// Parse function names from CREATE statements
const functions = [];
for (const file of files) {
  const content = readFileSync(path.join(FUNCTIONS_DIR, file), "utf-8");
  const matches = content.matchAll(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi
  );
  for (const match of matches) {
    const secDef = content.includes("SECURITY DEFINER") ? "DEFINER" : "INVOKER";
    const hasAnon =
      content.toLowerCase().includes("to anon");
    functions.push({
      name: match[1],
      file,
      security: secDef,
      anon: hasAnon,
    });
  }
}

// Display
functions.sort((a, b) => porovnej(a.name, b.name));
const maxName = Math.max(...functions.map((f) => f.name.length), 4);

console.log(
  `${"FUNCTION".padEnd(maxName + 2)} ${"SECURITY".padEnd(10)} ${"ANON".padEnd(6)} FILE`
);
console.log("-".repeat(maxName + 2 + 10 + 6 + 30));

for (const fn of functions) {
  console.log(
    `${fn.name.padEnd(maxName + 2)} ${fn.security.padEnd(10)} ${(fn.anon ? "yes" : "no").padEnd(6)} ${fn.file}`
  );
}

console.log(`\nTotal: ${functions.length} function(s) in ${files.length} file(s)\n`);

// Live comparison
if (isLive) {
  console.log("🔍 Comparing with live local DB...\n");
  try {
    const result = execSync(
      `PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' ORDER BY p.proname"`,
      { encoding: "utf-8" }
    );
    const liveFunctions = new Set(result.trim().split("\n").filter(Boolean));
    const sourceNames = new Set(functions.map((f) => f.name));

    const onlyInSource = [...sourceNames].filter((n) => !liveFunctions.has(n));
    const onlyInDb = [...liveFunctions].filter((n) => !sourceNames.has(n));

    if (onlyInSource.length > 0) {
      console.log("⚠️  In source but NOT in DB:");
      onlyInSource.forEach((n) => console.log(`   - ${n}`));
    }
    if (onlyInDb.length > 0) {
      console.log("⚠️  In DB but NOT in source:");
      onlyInDb.forEach((n) => console.log(`   + ${n}`));
    }
    if (onlyInSource.length === 0 && onlyInDb.length === 0) {
      console.log("✅ Source and DB are in sync");
    }
  } catch {
    console.error("❌ Could not connect to local DB. Is the local PostgreSQL stack running?");
  }
  console.log("");
}
