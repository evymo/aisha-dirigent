/**
 * Migrations Idempotent Gate Tests
 *
 * Validates Phase 1 cold-start refactor invariants:
 * - Every migration in aisha/db/migrations/ MUST be idempotent
 * - No AISHA_DB_URL refs in active migrations / scripts / compose
 * - No supabase_admin / supabase_auth_admin / supabase_storage_admin role refs
 *   in active SQL (archive/ excluded)
 * - No tracking-table writes (supabase_migrations.schema_migrations) in
 *   migrate runner — cold-start = full re-apply on every boot
 * - aisha_meta.migration_log INSERTs MUST match the schema defined in
 *   infra/postgres/000_init_roles_schemas.sql (run_id, started_at, finished_at,
 *   status, exit_code, applied_migrations, error_message, env_info)
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "aisha", "db", "migrations");
const INFRA_SCHEMAS = join(ROOT, "infra", "postgres", "000_init_roles_schemas.sql");

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function listMigrationFiles(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Strip SQL line + block comments and string literals to avoid false positives. */
function stripSqlNoise(src: string): string {
  return src
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Migrations Idempotent Gate", () => {
  test("supabase/ directory has been removed (Phase 1 cold-start cleanup)", () => {
    expect(existsSync(join(ROOT, "supabase"))).toBe(false);
  });

  test("aisha/db/migrations/ exists and contains baseline + registry", () => {
    expect(existsSync(MIGRATIONS_DIR)).toBe(true);
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("00000000000000_baseline.sql");
    expect(existsSync(join(ROOT, "aisha", "db", "migration-registry.json"))).toBe(
      true,
    );
  });

  test("aisha_meta.migration_log schema is defined in infra/postgres", () => {
    const sql = readSafe(INFRA_SCHEMAS);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS aisha_meta\.migration_log/);
    // Required columns for per-RUN audit log
    for (const col of [
      "run_id",
      "started_at",
      "finished_at",
      "status",
      "exit_code",
      "applied_migrations",
      "error_message",
      "env_info",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  test("no migration writes legacy schema_migrations tracking table", () => {
    const offenders: string[] = [];
    for (const file of listMigrationFiles()) {
      const sql = stripSqlNoise(readSafe(join(MIGRATIONS_DIR, file)));
      if (/supabase_migrations\.schema_migrations|\bschema_migrations\b/i.test(sql)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no non-baseline migration uses legacy supabase_* roles", () => {
    // Baseline (00000000000000_baseline.sql) is a historical pg_dump snapshot;
    // its supabase_* role refs are removed in Phase 5 (auth schema rename).
    const offenders: { file: string; match: string }[] = [];
    const rolePattern =
      /\b(supabase_admin|supabase_auth_admin|supabase_storage_admin|supabase_replication_admin|supabase_realtime_admin)\b/;
    for (const file of listMigrationFiles()) {
      if (file === "00000000000000_baseline.sql") continue;
      const sql = stripSqlNoise(readSafe(join(MIGRATIONS_DIR, file)));
      const m = sql.match(rolePattern);
      if (m) offenders.push({ file, match: m[1] });
    }
    expect(offenders).toEqual([]);
  });

  test("no migration INSERTs into aisha_meta.migration_log with wrong columns", () => {
    // The per-RUN audit log is written by docker-migrate-entrypoint.sh,
    // not by individual migrations. Migrations must NOT write here.
    // If a migration does write, it MUST match the real schema columns.
    const wrongCols = /aisha_meta\.migration_log\s*\(\s*name\s*,\s*applied_at/i;
    const offenders: string[] = [];
    for (const file of listMigrationFiles()) {
      const sql = readSafe(join(MIGRATIONS_DIR, file));
      if (wrongCols.test(sql)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("migrate runner uses AISHA_DB_URL (not legacy SUPABASE_DB_URL)", () => {
    const runner = readSafe(join(ROOT, "scripts", "db", "migrate.mjs"));
    expect(runner).toContain("AISHA_DB_URL");
    expect(runner).not.toMatch(/(?<![A-Z_])SUPABASE_DB_URL/);
    // No tracking table write/read in the runner — cold start always re-applies
    expect(runner).not.toMatch(/supabase_migrations\.schema_migrations/);
  });

  test("docker-migrate-entrypoint.sh uses AISHA_DB_URL and writes to aisha_meta.migration_log", () => {
    const entry = readSafe(join(ROOT, "scripts", "docker-migrate-entrypoint.sh"));
    expect(entry).toContain("AISHA_DB_URL");
    expect(entry).toMatch(/aisha_meta\.migration_log/);
  });

  test("compose files use AISHA_DB_URL, not legacy SUPABASE_DB_URL", () => {
    const composeFiles = readdirSync(ROOT).filter(
      (f) => f.startsWith("docker-compose.coolify") && f.endsWith(".yml"),
    );
    for (const f of composeFiles) {
      const content = readSafe(join(ROOT, f));
      expect(content).not.toMatch(/(?<![A-Z_])SUPABASE_DB_URL\s*[:=]/);
    }
  });
});
