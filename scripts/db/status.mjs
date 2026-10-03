#!/usr/bin/env node
/**
 * DB Status Checker
 *
 * Displays local or remote DB status: connection, migration count, table count.
 *
 * Usage:
 *   node scripts/db/status.mjs           # Remote
 *   node scripts/db/status.mjs --local   # Local (AISHA_LOCAL_DB_URL or default port 57422)
 *
 * @module
 */
import { execFileSync } from "child_process";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LOCAL_DB } from "./lib/local-db.mjs";
import { psqlPripojeni } from "./lib/psql-pripojeni.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "aisha", "db", "migrations");
const REGISTRY_PATH = path.join(ROOT, "aisha", "db", "migration-registry.json");

const isLocal = process.argv.includes("--local");

// LOCAL_DB is imported from ./lib/local-db.mjs.
// It reads AISHA_LOCAL_DB_URL (default: postgresql://postgres:postgres@127.0.0.1:57422/postgres).
// Set AISHA_LOCAL_DB_URL to switch to the local-warmup stack (port 54322).

let lastPsqlError = "";
function psql(query) {
  // execFileSync (no shell) — avoids command injection and shell quote-escaping
  // for SQL that contains single quotes / parens (e.g. to_regclass('...')).
  try {
    // Vzdálená DB: heslo prostředím, ne v argv (viz lib/psql-pripojeni.mjs).
    // Uvnitř try: chybějící adresa se hlásí jako neúspěšné spojení, jako dřív.
    const vzdalene = isLocal ? null : psqlPripojeni(process.env.AISHA_DB_URL || process.env.DATABASE_URL);
    const connArgs = isLocal
      ? ["-h", LOCAL_DB.host, "-p", String(LOCAL_DB.port), "-U", LOCAL_DB.user, "-d", LOCAL_DB.database]
      : [vzdalene.cil];
    const env = isLocal
      ? { ...process.env, PGPASSWORD: LOCAL_DB.password }
      : vzdalene.env;
    return execFileSync("psql", [...connArgs, "-t", "-A", "-c", query], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env,
    }).trim();
  } catch (err) {
    lastPsqlError = String(err.stderr || err.message || "");
    return null;
  }
}

const target = isLocal ? `Local PostgreSQL (${LOCAL_DB.host}:${LOCAL_DB.port})` : "Remote DB";
console.log(`\n🗃️  DB Status — ${target}\n`);

// 1. Connection test
const connTest = psql("SELECT 1");
if (connTest === "1") {
  console.log("✅ Connection: OK");
} else {
  console.log("❌ Connection: FAILED");
  if (isLocal) {
    if (/password authentication failed/i.test(lastPsqlError)) {
      console.log(`   Auth rejected for ${LOCAL_DB.user}:***@${LOCAL_DB.host}:${LOCAL_DB.port}.`);
      console.log("   The running DB is likely the cold-start / e2e substrate (generated");
      console.log("   password + scram over Docker's port-forward), not the simple local-dev");
      console.log("   DB these :local scripts target. To regenerate types without it:");
      console.log("      npm run db:types:refresh:throwaway");
    } else {
      console.log("   Is the local PostgreSQL stack running?");
    }
  }
  process.exit(1);
}

// 2. Applied migrations count
const appliedCount = psql(
  "SELECT count(*) FROM aisha_meta.applied_migrations"
);
console.log(`📦 Applied migrations: ${appliedCount || "unknown"}`);

// 3. Disk migration files
const diskFiles = existsSync(MIGRATIONS_DIR)
  ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length
  : 0;
console.log(`📁 Migration files on disk: ${diskFiles}`);

// 4. Registry count
if (existsSync(REGISTRY_PATH)) {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  console.log(
    `📋 Registered migrations: ${registry.migrations.length} (+ baseline)`
  );
}

// 5. Table count
const tableCount = psql(
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
);
console.log(`📊 Public tables: ${tableCount || "unknown"}`);

// 6. RPC function count
const funcCount = psql(
  "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public'"
);
console.log(`⚙️  Public functions: ${funcCount || "unknown"}`);

// 7. RLS enabled table count
const rlsCount = psql(
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true"
);
console.log(`🔒 Tables with RLS: ${rlsCount || "unknown"}`);

// 8. Identity user count
const userCount = psql(
  "SELECT CASE WHEN to_regclass('keycloak.user_entity') IS NOT NULL THEN (SELECT count(*)::text FROM keycloak.user_entity) WHEN to_regclass('aisha_auth.users') IS NOT NULL THEN (SELECT count(*)::text FROM aisha_auth.users) ELSE 'n/a' END"
);
console.log(`👤 Identity users: ${userCount || "unknown"}`);

console.log("");
