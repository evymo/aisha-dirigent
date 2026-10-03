import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const BASELINE_META_PATH = path.join(ROOT, "aisha", "db", "baseline-meta.json");
const MIGRATIONS_DIR = path.join(ROOT, "aisha", "db", "migrations");
const SQL_ROOT = path.join(ROOT, "aisha", "db", "sql");

function listSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSqlFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith(".sql")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

describe("baseline metadata sync", () => {
  it("tracks current source-of-truth and non-baseline migration state", () => {
    const raw = JSON.parse(fs.readFileSync(BASELINE_META_PATH, "utf-8"));
    const nonBaselineMigrations = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql") && file !== "00000000000000_baseline.sql")
      .sort();
    const sourceSqlFiles = listSqlFiles(SQL_ROOT);

    expect(raw.baseline?.source).toBe("aisha/db/sql/");
    expect(raw.baseline?.output).toBe("aisha/db/migrations/00000000000000_baseline.sql");
    expect(raw.baseline?.file_count).toBe(sourceSqlFiles.length);

    // ── pending_migrations + deferred_migrations contract ────────────────
    //
    // `pending_migrations` is read by scripts/db/migrate.mjs (as
    // `baselineSnapshotMigrations`) and interpreted as "migrations covered
    // by the regenerated baseline; mark them applied without re-running".
    //
    // For the skip-without-running optimization to be safe, an entry MUST
    // be a migration whose CREATE statements are already in baseline.sql
    // ("absorbed"). The remaining non-baseline migrations are "deferred" —
    // the runner WILL apply them on top of baseline.
    //
    // Combined invariant: pending_migrations ∪ deferred_migrations must
    // equal the set of all non-baseline .sql files on disk. The split
    // between the two is computed by `classifyMigrationsAgainstBaseline()`
    // in scripts/db/generate-init-migration-from-sources.mjs based on
    // whether each migration's CREATE'd relations appear in baseline.sql.
    //
    // History: before 2026-05-24 this test asserted
    //   `pending_migrations === all non-baseline migrations on disk`
    // — which silently put data-only / tenant-specific migrations in the
    // skip-without-running set, producing ghost-applied migrations. See
    // src/tests/gates/baseline-meta-pending-migrations-truly-absorbed.gate.test.ts
    // for the integrity gate that prevents recurrence.
    const pending: string[] = Array.isArray(raw.pending_migrations) ? raw.pending_migrations : [];
    const deferred: string[] = Array.isArray(raw.deferred_migrations) ? raw.deferred_migrations : [];

    expect(pending.every((f) => nonBaselineMigrations.includes(f)), "pending_migrations must be a subset of on-disk non-baseline migrations").toBe(true);
    expect(deferred.every((f) => nonBaselineMigrations.includes(f)), "deferred_migrations must be a subset of on-disk non-baseline migrations").toBe(true);

    // Disjoint: a migration can be absorbed OR deferred, never both.
    const inBoth = pending.filter((f) => deferred.includes(f));
    expect(inBoth, `migrations cannot appear in both lists; offenders: ${inBoth.join(", ")}`).toEqual([]);

    // Union = all non-baseline migrations on disk (no migration is silently dropped).
    const union = [...new Set([...pending, ...deferred])].sort();
    expect(union).toEqual(nonBaselineMigrations);
  });
});
