#!/usr/bin/env node
/**
 * DB Migration Runner — baseline init + tracked delta model
 *
 * New databases are initialized from the generated source-of-truth baseline.
 * Existing databases apply only migrations missing from AISHA metadata.
 *
 * Usage:
 *   node scripts/db/migrate.mjs          # Remote (uses AISHA_DB_URL)
 *   node scripts/db/migrate.mjs --dry    # Show what would run
 *
 * @module
 */
import { execFileSync } from "child_process";
import { readFileSync, readdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { psqlPripojeni } from "./lib/psql-pripojeni.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "aisha", "db", "migrations");
const REGISTRY_PATH = path.join(ROOT, "aisha", "db", "migration-registry.json");
const BASELINE_META_PATH = path.join(ROOT, "aisha", "db", "baseline-meta.json");
const BASELINE_FILE = "00000000000000_baseline.sql";

const isDryRun = process.argv.includes("--dry");

const MAX_BUFFER = 100 * 1024 * 1024; // 100 MB — baseline produces large output

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function versionFromFile(file) {
  return file.replace(/\.sql$/u, "").split("_")[0];
}

/**
 * Content checksum (sha256, hex) of a migration file's body. The unit of
 * drift detection: if a file's body changes after it was applied, its checksum
 * changes, and the runner re-applies it (SoT-paired deltas are idempotent
 * CREATE OR REPLACE) so corrective edits propagate to already-migrated DBs.
 */
function fileChecksum(file) {
  const body = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
  return createHash("sha256").update(body).digest("hex");
}

function getConnectionString() {
  const url =
    process.env.AISHA_DB_URL ||
    process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ AISHA_DB_URL or DATABASE_URL required");
    process.exit(2);
  }
  // Defensive: Coolify v4 may inject env values wrapped in single quotes
  // (real_value="'WJQ…'"). Strip a single pair of surrounding quotes from
  // the password component (between `:` and `@`) so psql sees the actual
  // 24-char password, not the 26-char literal-with-quotes string.
  const normalized = url.replace(
    /^(postgres(?:ql)?:\/\/[^:]+:)'([^@]*)'(@.*)$/,
    "$1$2$3"
  );
  return normalized;
}

function getMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`❌ Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function readBaselineSnapshotMigrations() {
  if (!existsSync(BASELINE_META_PATH)) {
    return [];
  }

  const meta = JSON.parse(readFileSync(BASELINE_META_PATH, "utf-8"));
  return Array.isArray(meta.pending_migrations) ? meta.pending_migrations : [];
}

function checkRegistryParity() {
  if (!existsSync(REGISTRY_PATH)) {
    console.warn("⚠️  migration-registry.json not found, skipping registry check");
    return;
  }
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  const registeredSet = new Set(registry.migrations);
  const diskFiles = getMigrationFiles().filter(
    (f) => f !== "00000000000000_baseline.sql"
  );
  const unregistered = diskFiles.filter((f) => !registeredSet.has(f));
  if (unregistered.length > 0) {
    console.warn("⚠️  Unregistered migrations found:");
    unregistered.forEach((f) => console.warn(`   ${f}`));
    console.warn("   Run: npm run db:migration:register");
  }
}

function runPsql(connStr, args, options = {}) {
  // Retry on transient auth failures. Round 22 migration_log_dump showed
  // these "auth races" actually persist for 20+ seconds in the worst case
  // (pg17 background password re-applier still settling), so we budget
  // generously. 60 attempts × 2 s = 2 min. Each retry uses execSync sleep
  // (not a busy spin loop) so we don't burn CPU while waiting.
  const MAX_ATTEMPTS = 60;
  // Heslo prostředím, ne v argv: `err.message` (záloha, když psql nevrátí
  // stderr) jinak nese celý příkaz i s heslem — viz lib/psql-pripojeni.mjs.
  const pripojeni = psqlPripojeni(connStr, options.env ?? process.env);
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return execFileSync("psql", [pripojeni.cil, ...args], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: MAX_BUFFER,
        ...options,
        env: pripojeni.env,
      });
    } catch (err) {
      lastErr = err;
      const stderr = String(err.stderr || "");
      const isAuth = /password authentication failed|FATAL:/i.test(stderr);
      if (!isAuth || attempt === MAX_ATTEMPTS) {
        throw err;
      }
      // Surface progress every 5 attempts so the migration_log_dump trail
      // doesn't become a wall of identical warning lines.
      if (attempt === 1 || attempt % 5 === 0) {
        console.warn(
          `   ⚠ psql attempt ${attempt}/${MAX_ATTEMPTS} failed (auth race); sleeping 2 s before retry`
        );
      }
      execFileSync("sleep", ["2"], { stdio: "ignore" });
    }
  }
  throw lastErr;
}

function psqlScalar(connStr, sql) {
  return runPsql(connStr, ["-v", "ON_ERROR_STOP=1", "-tA", "-c", sql]).trim();
}

function psqlExec(connStr, sql) {
  runPsql(connStr, ["-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function ensureMigrationTracking(connStr) {
  psqlExec(
    connStr,
    `CREATE SCHEMA IF NOT EXISTS aisha_meta;
     CREATE TABLE IF NOT EXISTS aisha_meta.applied_migrations (
       version text PRIMARY KEY,
       name text NOT NULL,
       inserted_at timestamptz NOT NULL DEFAULT now()
     );
     -- Body checksum, added in-place for DBs created before drift tracking.
     -- NULL = legacy row (recorded before checksums) → backfilled on next run.
     ALTER TABLE aisha_meta.applied_migrations
       ADD COLUMN IF NOT EXISTS checksum text;`
  );
}

function getAppliedVersions(connStr) {
  const out = psqlScalar(
    connStr,
    "SELECT version FROM aisha_meta.applied_migrations ORDER BY version"
  );
  return new Set(out.split("\n").map((line) => line.trim()).filter(Boolean));
}

/**
 * version → recorded checksum (string, or "" when the column is NULL = legacy
 * row recorded before drift tracking existed). Uses E'\t' as a field separator
 * that cannot occur in a hex digest or a numeric version, so the split is exact.
 */
function getAppliedChecksums(connStr) {
  const out = psqlScalar(
    connStr,
    "SELECT version || E'\\t' || COALESCE(checksum, '') " +
      "FROM aisha_meta.applied_migrations ORDER BY version"
  );
  const map = new Map();
  for (const line of out.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [version, checksum = ""] = line.split("\t");
    map.set(version, checksum);
  }
  return map;
}

function hasBaselineSchema(connStr) {
  return psqlScalar(
    connStr,
    "SELECT CASE WHEN to_regclass('public.profiles') IS NULL THEN '0' ELSE '1' END"
  ) === "1";
}

/**
 * Detect partial baseline application — when public schema has SOME tables
 * but not the canonical marker (`profiles`). Happens when a previous baseline
 * run aborted mid-way (e.g. extension already present, RLS conflict).
 *
 * Returns true if public schema has any non-system tables but `profiles` is missing.
 * Caller should drop+recreate public schema before retrying baseline.
 */
function hasPartialPublicSchema(connStr) {
  const tableCount = psqlScalar(
    connStr,
    `SELECT count(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`
  );
  return parseInt(tableCount, 10) > 0 && !hasBaselineSchema(connStr);
}

/**
 * Drop+recreate public schema. Safe to call ONLY when applied_migrations is empty
 * (= no migrations have been recorded as successful, so wiping is recoverable).
 */
function resetPublicSchema(connStr) {
  psqlExec(
    connStr,
    `DROP SCHEMA IF EXISTS public CASCADE;
     CREATE SCHEMA public;
     GRANT ALL ON SCHEMA public TO postgres;
     GRANT USAGE, CREATE ON SCHEMA public TO public;`
  );
}

function markApplied(connStr, file) {
  const version = versionFromFile(file);
  // The baseline is regenerated wholesale and re-applied only via the explicit
  // FORCE_BASELINE_RESET path, never via drift re-apply, so it carries no
  // checksum (NULL) — drift detection skips it. Every delta records its body
  // checksum, and a re-apply refreshes it (DO UPDATE, not DO NOTHING).
  const checksum = file === BASELINE_FILE ? null : fileChecksum(file);
  const checksumLiteral = checksum === null ? "NULL" : sqlLiteral(checksum);
  psqlExec(
    connStr,
    `INSERT INTO aisha_meta.applied_migrations (version, name, checksum)
     VALUES (${sqlLiteral(version)}, ${sqlLiteral(file)}, ${checksumLiteral})
     ON CONFLICT (version) DO UPDATE
       SET name = EXCLUDED.name, checksum = EXCLUDED.checksum;`
  );
}

function markAppliedBatch(connStr, files) {
  for (const file of files) {
    markApplied(connStr, file);
  }
}

function applyMigration(connStr, file) {
  const filePath = path.join(MIGRATIONS_DIR, file);
  runPsql(connStr, ["-v", "ON_ERROR_STOP=1", "-f", filePath]);
  markApplied(connStr, file);
}

// ── Main ──
const files = getMigrationFiles();
checkRegistryParity();

// Force-reset path: AISHA_DB_FORCE_BASELINE_RESET=1 drops public schema + clears
// applied_migrations tracking. Triggers full re-apply of baseline + migrations.
// Use case: regenerated baseline.sql adds tables/columns that previous baseline
// didn't have; without reset, applied_migrations tracking skips re-apply →
// schema drift between disk baseline and DB. SAFE only on fresh/dev deploys.
const forceBaselineReset = process.env.AISHA_DB_FORCE_BASELINE_RESET === "1";

if (isDryRun) {
  console.log(`\n[DRY RUN] Migration files from aisha/db/migrations/`);
  files.forEach((f) => console.log(`   ${f}`));
  process.exit(0);
}

const connStr = getConnectionString();
const baselineSnapshotMigrations = new Set(readBaselineSnapshotMigrations());
const diskFileSet = new Set(files);

console.log("\n📦 Applying DB migrations (baseline init + tracked deltas)...");

try {
  ensureMigrationTracking(connStr);
} catch (err) {
  console.error(`❌ Failed to prepare migration tracking: ${err.stderr || err.message}`);
  process.exit(1);
}

if (forceBaselineReset) {
  console.log("   ⚠ AISHA_DB_FORCE_BASELINE_RESET=1 — dropping public schema + tracking");
  try {
    resetPublicSchema(connStr);
    psqlExec(connStr, "TRUNCATE TABLE aisha_meta.applied_migrations;");
  } catch (err) {
    console.error(`❌ Failed force reset: ${err.stderr || err.message}`);
    process.exit(1);
  }
}

let appliedVersions;
let schemaInitialized;

try {
  appliedVersions = getAppliedVersions(connStr);
  schemaInitialized = hasBaselineSchema(connStr);
} catch (err) {
  console.error(`❌ Failed to inspect migration state: ${err.stderr || err.message}`);
  process.exit(1);
}

const baselineVersion = versionFromFile(BASELINE_FILE);
let baselineReady = appliedVersions.has(baselineVersion) || schemaInitialized;

if (diskFileSet.has(BASELINE_FILE) && !appliedVersions.has(baselineVersion)) {
  if (schemaInitialized) {
    console.log(`   ↳ ${BASELINE_FILE} already present in schema; adopting baseline state`);
    try {
      markApplied(connStr, BASELINE_FILE);
    } catch (err) {
      console.error(`❌ Failed to record ${BASELINE_FILE}: ${err.stderr || err.message}`);
      process.exit(1);
    }
  } else {
    // Partial schema detection — safe-recoverable state
    if (hasPartialPublicSchema(connStr)) {
      console.log(
        `   ⚠ public schema has tables but '${BASELINE_FILE}' was never recorded ` +
        `as applied — assuming aborted previous run; resetting schema before retry`
      );
      try {
        resetPublicSchema(connStr);
      } catch (err) {
        console.error(`❌ Failed to reset partial schema: ${err.stderr || err.message}`);
        process.exit(1);
      }
    }
    console.log(`   → ${BASELINE_FILE}`);
    try {
      applyMigration(connStr, BASELINE_FILE);
    } catch (err) {
      console.error(`❌ Failed to apply ${BASELINE_FILE}: ${err.stderr || err.message}`);
      process.exit(1);
    }
  }
  baselineReady = true;
}

if (baselineReady) {
  const coveredByBaseline = [...baselineSnapshotMigrations].filter(
    (file) => diskFileSet.has(file) && !appliedVersions.has(versionFromFile(file))
  );
  if (coveredByBaseline.length > 0) {
    console.log(`   ↳ marking ${coveredByBaseline.length} migration(s) covered by generated baseline`);
    try {
      markAppliedBatch(connStr, coveredByBaseline);
    } catch (err) {
      console.error(`❌ Failed to record baseline-covered migrations: ${err.stderr || err.message}`);
      process.exit(1);
    }
  }
}

// ── Body-drift detection (deferred deltas only) ──
// An applied migration whose file body changed since it ran is "drifted". This
// is the missing half of version-only tracking: without it, a corrective edit to
// an already-applied delta (the fafa9019 / "existing DBs unaffected" class) is
// silently ignored. We ALWAYS surface drift; re-apply is opt-in
// (AISHA_DB_REAPPLY_CHANGED=1) because deferred deltas may include data
// migrations whose re-run would duplicate rows — the operator owns that call.
//
// Absorbed (baseline-covered) migrations are EXCLUDED: their bodies are
// authoritatively superseded by the regenerated baseline, so re-running an older
// body would revert it — exactly the deferred-re-apply defect we guard against.
// Legacy rows (checksum recorded as NULL, pre-tracking) are backfilled to the
// current body without re-applying: we cannot know whether a pre-tracking edit
// occurred, so we adopt the present state as the tracking origin.
const reapplyChanged = process.env.AISHA_DB_REAPPLY_CHANGED === "1";
let appliedChecksums;
try {
  appliedChecksums = getAppliedChecksums(connStr);
} catch (err) {
  console.error(`❌ Failed to read migration checksums: ${err.stderr || err.message}`);
  process.exit(1);
}

const legacyBackfill = [];
const driftedFiles = [];
for (const file of files) {
  if (file === BASELINE_FILE) continue;
  if (baselineSnapshotMigrations.has(file)) continue; // absorbed → never re-run
  const version = versionFromFile(file);
  if (!appliedChecksums.has(version)) continue; // not applied yet → handled below
  const recorded = appliedChecksums.get(version);
  const current = fileChecksum(file);
  if (recorded === "") {
    legacyBackfill.push({ version, current });
  } else if (recorded !== current) {
    driftedFiles.push(file);
  }
}

if (legacyBackfill.length > 0) {
  console.log(`   ↳ backfilling checksum for ${legacyBackfill.length} legacy-tracked migration(s)`);
  try {
    for (const { version, current } of legacyBackfill) {
      psqlExec(
        connStr,
        `UPDATE aisha_meta.applied_migrations
           SET checksum = ${sqlLiteral(current)}
         WHERE version = ${sqlLiteral(version)};`
      );
    }
  } catch (err) {
    console.error(`❌ Failed to backfill migration checksums: ${err.stderr || err.message}`);
    process.exit(1);
  }
}

if (driftedFiles.length > 0) {
  console.warn(`   ⚠ ${driftedFiles.length} applied migration(s) changed since last applied (body drift):`);
  driftedFiles.forEach((f) => console.warn(`      ~ ${f}`));
  if (reapplyChanged) {
    console.log(`   ↻ AISHA_DB_REAPPLY_CHANGED=1 — re-applying ${driftedFiles.length} drifted delta(s)`);
    for (const file of driftedFiles) {
      console.log(`   ↻ ${file}`);
      try {
        applyMigration(connStr, file); // re-runs body + refreshes checksum (DO UPDATE)
      } catch (err) {
        console.error(`❌ Failed to re-apply drifted ${file}: ${err.stderr || err.message}`);
        process.exit(1);
      }
    }
  } else {
    console.warn(`   ⚠ Schema may be stale vs these files. Set AISHA_DB_REAPPLY_CHANGED=1 to re-apply`);
    console.warn(`     (safe for idempotent CREATE OR REPLACE deltas; review data-migrations first).`);
  }
}

try {
  appliedVersions = getAppliedVersions(connStr);
} catch (err) {
  console.error(`❌ Failed to refresh migration state: ${err.stderr || err.message}`);
  process.exit(1);
}

const pendingFiles = files.filter((file) => {
  if (file === BASELINE_FILE) return false;
  return !appliedVersions.has(versionFromFile(file));
});

if (pendingFiles.length === 0) {
  console.log("✅ No pending migrations");
} else {
  console.log(`   pending: ${pendingFiles.length} migration(s)`);
  for (const file of pendingFiles) {
    console.log(`   → ${file}`);
    try {
      applyMigration(connStr, file);
    } catch (err) {
      console.error(`❌ Failed to apply ${file}: ${err.stderr || err.message}`);
      process.exit(1);
    }
  }
  console.log("✅ All migrations applied");
}

// ── Post-baseline heals — idempotent reconcile, applied on EVERY run ─────────
// The generated baseline is NEVER re-applied to an existing DB (markApplied
// records it with a NULL checksum → drift detection skips it; only the
// destructive AISHA_DB_FORCE_BASELINE_RESET re-runs it), and registry delta
// migrations are disallowed by the baseline-only release invariant. So a
// post-baseline schema change to an EXISTING table never reaches an already-
// initialized DB via the baseline or a delta. aisha/db/heals.sql carries
// idempotent reconcile DDL (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF
// EXISTS) run here on EVERY migrate (also when there are no pending deltas — the
// existing-DB case): it ADDS the missing schema on existing DBs and is a no-op
// on fresh DBs (the baseline already created it). This is the non-destructive
// incremental-update path for the wipe-first baseline model — runs BEFORE the
// entrypoint's db:seed so the seed finds the reconciled schema.
const HEALS_FILE = path.join(ROOT, "aisha", "db", "heals.sql");
if (existsSync(HEALS_FILE)) {
  console.log("   → applying post-baseline heals (aisha/db/heals.sql)");
  try {
    runPsql(connStr, ["-v", "ON_ERROR_STOP=1", "-f", HEALS_FILE]);
    console.log("✅ Heals applied");
  } catch (err) {
    console.error(`❌ Failed to apply heals.sql: ${err.stderr || err.message}`);
    process.exit(1);
  }
}

process.exit(0);
