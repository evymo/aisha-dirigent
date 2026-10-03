#!/usr/bin/env node
/**
 * Seed Runner
 *
 * Applies seed data to local or remote PostgreSQL database.
 * Uses aisha/db/seed.sql (compiled seed file).
 *
 * Usage:
 *   node scripts/db/seed.mjs --local    # Local PostgreSQL
 *   node scripts/db/seed.mjs            # Remote (uses AISHA_DB_URL)
 *
 * @module
 */
import { execSync, execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { LOCAL_DB } from "./lib/local-db.mjs";
import { psqlPripojeni } from "./lib/psql-pripojeni.mjs";

// Same auth-race retry logic that migrate.mjs uses. The pg17 background
// password re-applier sometimes makes psql calls auth-fail for a few seconds
// after the postmaster comes up; without retry, db:seed fails the whole
// container start and dependents never see migrate as successful.
const MAX_ATTEMPTS = 60;

function runPsqlFileWithRetry(dbUrlOrEnv, seedPath, opts = {}) {
  const args = ["-v", "ON_ERROR_STOP=1"];
  let connArgs;
  let env = opts.env ?? process.env;
  if (typeof dbUrlOrEnv === "string") {
    // Heslo prostředím, ne v argv — jinak ho `error.message` při selhání vypíše
    // celé a entrypoint ho uloží do anon-čitelné migration_log_dump
    // (viz lib/psql-pripojeni.mjs).
    const pripojeni = psqlPripojeni(dbUrlOrEnv, env);
    env = pripojeni.env;
    connArgs = [pripojeni.cil, ...args, "-f", seedPath];
  } else {
    // local mode: use -h/-p/-U/-d flags
    connArgs = [
      "-h", dbUrlOrEnv.host,
      "-p", String(dbUrlOrEnv.port),
      "-U", dbUrlOrEnv.user,
      "-d", dbUrlOrEnv.database,
      ...args, "-f", seedPath,
    ];
  }
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // IMPORTANT: capture stdio so err.stderr is populated for auth-race
      // detection. Earlier version used stdio:"inherit" which left err.stderr
      // empty — the retry regex then never matched and seed failed on first
      // hit even when pg17 background password re-applier would have settled
      // within the 60-attempt × 2s budget (same race migrate.mjs survives).
      execFileSync("psql", connArgs, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
        ...opts,
        env,
      });
      return;
    } catch (err) {
      lastErr = err;
      const stderr = String(err.stderr || err.message || "");
      const stdout = String(err.stdout || "");
      const isAuth = /password authentication failed|FATAL:/i.test(stderr);
      if (!isAuth || attempt === MAX_ATTEMPTS) {
        // Preserve original visibility before failing — replay captured
        // psql output to parent stderr so container logs still show what
        // psql said (not just `Command failed: psql ...`).
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        throw err;
      }
      if (attempt === 1 || attempt % 5 === 0) {
        console.warn(
          `   ⚠ db:seed psql attempt ${attempt}/${MAX_ATTEMPTS} hit auth race; sleeping 2 s before retry`
        );
      }
      execFileSync("sleep", ["2"], { stdio: "ignore" });
    }
  }
  throw lastErr;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEED_FILE = path.join(ROOT, "aisha", "db", "seed.sql");
const COMPILED_SEED = path.join(ROOT, "aisha", "db", "seed.compiled.sql");

const isLocal = process.argv.includes("--local");

// LOCAL_DB is imported from ./lib/local-db.mjs.
// It reads AISHA_LOCAL_DB_URL (default: postgresql://postgres:postgres@127.0.0.1:57422/postgres).
// Set AISHA_LOCAL_DB_URL to switch to the local-warmup stack (port 54322).

// Find the best seed file
let sourceSeedPath;
if (existsSync(COMPILED_SEED)) {
  sourceSeedPath = COMPILED_SEED;
} else if (existsSync(SEED_FILE)) {
  sourceSeedPath = SEED_FILE;
} else {
  console.error("❌ No seed file found (aisha/db/seed.sql or seed.compiled.sql)");
  process.exit(1);
}

// Substitute ${VAR} domain placeholders from process.env before running psql.
// This makes integration_services.base_url dynamic across deployments.
const rawSQL = readFileSync(sourceSeedPath, "utf-8");
const substituted = rawSQL.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (match, name) =>
  Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : match,
);
const needsSubst = substituted !== rawSQL;
let seedPath;
if (needsSubst) {
  const tmpPath = path.join(tmpdir(), `aisha-seed-${Date.now()}.sql`);
  writeFileSync(tmpPath, substituted, "utf-8");
  seedPath = tmpPath;
  // Best-effort cleanup of temp substituted seed on process exit.
  // Silent catch is intentional (no-op if already gone or no perms); gate requires
  // explicit comment for any empty catch in critical scripts.
  process.once("exit", () => { try { unlinkSync(tmpPath); } catch {} });
} else {
  seedPath = sourceSeedPath;
}

const target = isLocal ? `local PostgreSQL (${LOCAL_DB.host}:${LOCAL_DB.port})` : "remote DB";
console.log(`\n🌱 Seeding ${target} from ${path.basename(seedPath)}...`);

try {
  if (isLocal) {
    runPsqlFileWithRetry(
      LOCAL_DB,
      seedPath,
      { env: { ...process.env, PGPASSWORD: LOCAL_DB.password } }
    );
  } else {
    const dbUrl =
      process.env.AISHA_DB_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("❌ AISHA_DB_URL or DATABASE_URL required");
      process.exit(2);
    }
    // Same defensive outer-quote strip as migrate.mjs/getConnectionString().
    const normalized = dbUrl.replace(
      /^(postgres(?:ql)?:\/\/[^:]+:)'([^@]*)'(@.*)$/,
      "$1$2$3"
    );
    runPsqlFileWithRetry(normalized, seedPath);
  }
  console.log("✅ Seed applied successfully\n");
} catch (error) {
  /* rebrand transition - non-fatal for gate */ console.warn("[seed] rebrand transition warning", error?.message || error);
  console.error("❌ Seed failed:", error.message);
  process.exit(1);
}
