/**
 * Baseline-meta `pending_migrations` truly-absorbed Gate
 *
 * Background:
 *   `aisha/db/baseline-meta.json` carries a `pending_migrations` list that
 *   the migrate runner (`scripts/db/migrate.mjs`) interprets — under the
 *   variable name `baselineSnapshotMigrations` — as "migrations covered by
 *   the regenerated baseline; mark them applied without re-running". See
 *   migrate.mjs §"baselineReady" branch.
 *
 *   For this skip-without-running optimization to be safe, every migration
 *   in `pending_migrations` MUST already have its content (CREATE TABLE /
 *   INDEX / FUNCTION / VIEW / TYPE / SEQUENCE / TRIGGER) present in the
 *   regenerated `00000000000000_baseline.sql`. Otherwise the runner marks
 *   the migration applied while the schema lacks the corresponding objects —
 *   the "ghost-applied migration" failure mode.
 *
 * Real-world incident (cheers staging, 2026-05-24):
 *   15 cheers/* migrations were listed in `pending_migrations` despite their
 *   CREATE TABLE statements never being folded into `aisha/db/sql/` (tenant-
 *   specific, lives only in `aisha/db/migrations/`). The runner marked them
 *   all applied at deploy time; the `branding_hostname_mapping` table never
 *   actually existed. The cheers tenant hook then failed at its 3rd
 *   foundation seed (`branding_hostname_mapping.sql`) with
 *   `ERROR: relation "public.branding_hostname_mapping" does not exist`,
 *   bailing before content seeds + i18n could populate the rest of the
 *   tenant data layer.
 *
 * Invariants enforced here:
 *   1. Every file in `pending_migrations` declares ≥ 1 schema CREATE
 *      statement (pure data migrations cannot be absorbed by baseline).
 *   2. Every declared CREATE'd relation in those files is also CREATE'd
 *      somewhere in baseline.sql.
 *
 * Failure surfaces:
 *   - Lists offending migration files and the missing relations
 *   - Reminds the developer to either:
 *       a) Move the migration's content into `aisha/db/sql/` source-of-truth
 *          and regenerate baseline (`npm run db:init:generate`), so it
 *          becomes legitimately absorbed; OR
 *       b) Move the migration out of `pending_migrations` into
 *          `deferred_migrations` (the generator does this automatically
 *          when re-run).
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const META_PATH = resolve(ROOT, "aisha/db/baseline-meta.json");
const BASELINE_SQL_PATH = resolve(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");
const MIGRATIONS_DIR = resolve(ROOT, "aisha/db/migrations");

interface BaselineMeta {
  pending_migrations?: string[];
  deferred_migrations?: string[];
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const CREATE_RE =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|FUNCTION|VIEW|MATERIALIZED\s+VIEW|TYPE|SEQUENCE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\.)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi;

function extractCreatedRelations(sql: string): string[] {
  const stripped = stripSqlComments(sql);
  const names = new Set<string>();
  for (const m of stripped.matchAll(CREATE_RE)) {
    names.add(m[1].replace(/^"|"$/g, "").toLowerCase());
  }
  return [...names];
}

function baselineDefinesRelation(baselineSql: string, relationName: string): boolean {
  const escaped = relationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:UNIQUE\\s+)?(?:TABLE|INDEX|FUNCTION|VIEW|MATERIALIZED\\s+VIEW|TYPE|SEQUENCE|TRIGGER)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\\.)?"?${escaped}"?\\b`,
    "i",
  );
  return re.test(baselineSql);
}

describe("baseline-meta: pending_migrations must be truly absorbed by baseline.sql", () => {
  test("aisha/db/baseline-meta.json exists", () => {
    expect(existsSync(META_PATH), `expected baseline-meta at ${META_PATH}`).toBe(true);
  });

  test("aisha/db/migrations/00000000000000_baseline.sql exists", () => {
    expect(existsSync(BASELINE_SQL_PATH), `expected baseline.sql at ${BASELINE_SQL_PATH}`).toBe(
      true,
    );
  });

  test("every pending_migration is truly absorbed (no ghost migrations)", () => {
    if (!existsSync(META_PATH) || !existsSync(BASELINE_SQL_PATH)) {
      return; // earlier tests already failed; skip downstream
    }
    const meta = JSON.parse(readFileSync(META_PATH, "utf8")) as BaselineMeta;
    const pending = Array.isArray(meta.pending_migrations) ? meta.pending_migrations : [];
    if (pending.length === 0) return; // nothing to check

    const baselineSql = readFileSync(BASELINE_SQL_PATH, "utf8");

    const offenders: Array<{ file: string; reason: string; missing: string[] }> = [];
    for (const file of pending) {
      const abs = join(MIGRATIONS_DIR, file);
      if (!existsSync(abs)) {
        offenders.push({
          file,
          reason: "listed in pending_migrations but file does not exist on disk",
          missing: [],
        });
        continue;
      }
      const sql = readFileSync(abs, "utf8");
      const created = extractCreatedRelations(sql);
      if (created.length === 0) {
        offenders.push({
          file,
          reason:
            "pure data migration (no CREATE TABLE/INDEX/FUNCTION/VIEW/TYPE/SEQUENCE/TRIGGER) — cannot be absorbed by baseline; must always be applied separately",
          missing: [],
        });
        continue;
      }
      const missing = created.filter((rel) => !baselineDefinesRelation(baselineSql, rel));
      if (missing.length > 0) {
        offenders.push({
          file,
          reason: `${missing.length} CREATE'd relation(s) not present in baseline.sql`,
          missing,
        });
      }
    }

    if (offenders.length > 0) {
      const lines: string[] = [];
      lines.push("");
      lines.push(`${offenders.length} ghost-applied migration(s) in pending_migrations:`);
      lines.push("");
      for (const o of offenders) {
        lines.push(`  ▸ ${o.file}`);
        lines.push(`    ${o.reason}`);
        if (o.missing.length > 0) {
          lines.push(`    missing in baseline.sql: ${o.missing.join(", ")}`);
        }
      }
      lines.push("");
      lines.push("Each entry will be marked applied by migrate.mjs without ever creating the");
      lines.push("declared relation(s). Fix one of two ways:");
      lines.push("");
      lines.push("  (a) Move the migration's CREATE statements into the source-of-truth tree");
      lines.push("      `aisha/db/sql/` and regenerate baseline:");
      lines.push("        npm run db:init:generate");
      lines.push("      The next regen will fold the content into baseline.sql and the");
      lines.push("      migration becomes legitimately absorbed.");
      lines.push("");
      lines.push("  (b) Re-run the generator without changing source tree — it will move");
      lines.push("      non-absorbed entries out of `pending_migrations` into");
      lines.push("      `deferred_migrations` (informational), and the migrate runner will");
      lines.push("      then apply them on top of baseline as normal pending migrations.");
      throw new Error(lines.join("\n"));
    }
  });
});
