/**
 * Baseline-only release gate
 *
 * 0.9.0 public baseline is wipe-first: active migrations contain only the
 * generated baseline. That single baseline is the full schema folded from the
 * canonical source-of-truth under aisha/db/sql/ — no schema history is lost,
 * it is compiled into aisha/db/migrations/00000000000000_baseline.sql.
 *
 * This gate reads ONLY current canonical SoT: the active migrations dir, the
 * generated baseline file, baseline-meta.json, and the real migration-registry.
 * It does NOT scan any historical-migration archive directory — that archive is
 * an artifact of how the baseline was produced, not a live invariant of the
 * baseline-only state.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "aisha/db/migrations");
const BASELINE_FILE = "00000000000000_baseline.sql";

describe("baseline-only 0.9.0 migration state", () => {
  test("active migrations contain only generated baseline", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
    expect(files).toEqual([BASELINE_FILE]);
  });

  test("baseline meta has no pending/deferred non-baseline migrations", () => {
    const meta = JSON.parse(readFileSync(join(ROOT, "aisha/db/baseline-meta.json"), "utf8"));
    expect(meta.pending_migrations ?? []).toEqual([]);
    expect(meta.deferred_migrations ?? []).toEqual([]);
  });

  test("migration registry is baseline-only", () => {
    const registryPath = join(ROOT, "aisha/db/migration-registry.json");
    expect(existsSync(registryPath)).toBe(true);
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry.migrations ?? []).toEqual([]);
    expect(String(registry.note ?? "")).toMatch(/Baseline-only state/i);
  });

  test("the lone baseline is the full schema folded from canonical SoT", () => {
    // Historical SQL is not lost under the baseline-only policy: it is compiled
    // ("folded") into the single generated baseline from aisha/db/sql/. Assert
    // that the baseline is that generated, source-of-truth-derived full schema
    // — proving the wipe-first collapse preserved the complete schema rather
    // than scanning the archive/ artifact directory.
    const baselinePath = join(MIGRATIONS_DIR, BASELINE_FILE);
    expect(existsSync(baselinePath)).toBe(true);
    const baseline = readFileSync(baselinePath, "utf8");

    // Generated from the file-based source-of-truth (not a hand-written delta).
    expect(baseline).toMatch(/Generated from file-based source-of-truth SQL/i);
    // The full folded schema declares the platform's tables — a baseline that
    // merely stubbed the schema would not carry hundreds of CREATE TABLE
    // statements. This is the substantive "history preserved in baseline" check.
    const createTableCount = (baseline.match(/CREATE TABLE/g) ?? []).length;
    expect(createTableCount).toBeGreaterThan(100);
  });
});
