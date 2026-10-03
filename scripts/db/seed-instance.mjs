#!/usr/bin/env node
/**
 * Instance Seed Runner
 *
 * Applies THIS deployment's instance-specific seed data (the "instance" layer):
 * - the deployment's default story + operator-tier expert rules
 * - per-project stories / presets / knowledge items
 *
 * The instance layer is NOT for local/community installations. It lives OUTSIDE
 * the public repo in a private submodule mounted at aisha/db/seed/instance/
 * (see .gitmodules → aisha-instance-data). compile-seed.mjs reads the same dir.
 *
 * Resolution order (mirrors scripts/db/compile-seed.mjs):
 *   1. aisha/db/seed/instance/*.sql   — the private submodule (preferred)
 *   2. aisha/db/seed.instance.sql     — legacy single-file fallback
 *   3. (neither present)              — community/public install → no-op, exit 0
 *
 * Usage:
 *   node scripts/db/seed-instance.mjs --local   # Local PostgreSQL (AISHA_LOCAL_DB_URL or default 57422)
 *   node scripts/db/seed-instance.mjs            # Remote (needs AISHA_DB_URL)
 *
 * @module
 */
import { execFileSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LOCAL_DB } from "./lib/local-db.mjs";
import { psqlPripojeni } from "./lib/psql-pripojeni.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const INSTANCE_DIR = path.join(ROOT, "aisha", "db", "seed", "instance");
const LEGACY_FILE = path.join(ROOT, "aisha", "db", "seed.instance.sql");

/** Resolve the ordered list of instance seed SQL files (dir-preferred). */
function resolveInstanceFiles() {
  if (existsSync(INSTANCE_DIR)) {
    return readdirSync(INSTANCE_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => path.join(INSTANCE_DIR, f));
  }
  if (existsSync(LEGACY_FILE)) return [LEGACY_FILE];
  return [];
}

const seedFiles = resolveInstanceFiles();

if (seedFiles.length === 0) {
  // A clean / community / public-mirror install legitimately has no instance
  // layer (the private submodule is absent). This is not an error — the base
  // (core + translations) seed is applied separately.
  console.log(
    "ℹ️  No instance seed present (aisha/db/seed/instance/ submodule absent) — " +
      "skipping instance layer (community/public install).",
  );
  process.exit(0);
}

const isLocal = process.argv.includes("--local");

// LOCAL_DB is imported from ./lib/local-db.mjs.
// It reads AISHA_LOCAL_DB_URL (default: postgresql://postgres:postgres@127.0.0.1:57422/postgres).
// Set AISHA_LOCAL_DB_URL to switch to the local-warmup stack (port 54322).

const target = isLocal ? `local PostgreSQL (${LOCAL_DB.host}:${LOCAL_DB.port})` : "remote DB";
console.log(`\n🏢 Seeding instance data (${seedFiles.length} file(s)) to ${target}…`);

function applyFile(file) {
  const rel = path.relative(ROOT, file);
  console.log(`   → ${rel}`);
  if (isLocal) {
    // Bez shellu a heslo prostředím: řetězec příkazu by ho jinak nesl a
    // `err.message` níž by ho vypsal (viz lib/psql-pripojeni.mjs).
    execFileSync(
      "psql",
      ["-v", "ON_ERROR_STOP=1", "-h", LOCAL_DB.host, "-p", String(LOCAL_DB.port), "-U", LOCAL_DB.user, "-d", LOCAL_DB.database, "-f", file],
      { stdio: "inherit", env: { ...process.env, PGPASSWORD: LOCAL_DB.password } },
    );
  } else {
    const dbUrl = process.env.AISHA_DB_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("❌ AISHA_DB_URL or DATABASE_URL required for remote seeding");
      process.exit(2);
    }
    const { cil, env } = psqlPripojeni(dbUrl);
    execFileSync("psql", ["-v", "ON_ERROR_STOP=1", cil, "-f", file], { stdio: "inherit", env });
  }
}

try {
  for (const file of seedFiles) applyFile(file);
  console.log("✅ Instance seed applied successfully.");
} catch (err) {
  console.error("❌ Instance seed failed:", err.message);
  process.exit(1);
}
