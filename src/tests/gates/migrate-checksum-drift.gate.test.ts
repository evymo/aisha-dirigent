/**
 * migrate.mjs checksum / body-drift Gate
 *
 * Background:
 *   The runner (`scripts/db/migrate.mjs`) historically tracked applied
 *   migrations by VERSION only (`aisha_meta.applied_migrations.version`). That
 *   left a blind spot: when an already-applied delta's BODY is later corrected
 *   in place (e.g. fafa90190 — a deferred migration that re-created
 *   `fn_create_improvement_proposal` with an invalid `ai_event_type`), the
 *   change was silently ignored on databases that had already recorded that
 *   version. The commit that fixed it even noted: "migrate.mjs tracks by
 *   version (no checksum) so existing DBs unaffected."
 *
 *   This gate locks in the content-checksum tracking that closes that gap:
 *   each delta records a sha256 of its body, and a run detects when a recorded
 *   migration's body changed since it was applied ("drift").
 *
 * Safety-critical invariant (do NOT regress):
 *   Drift re-apply MUST exclude both the baseline AND absorbed
 *   (baseline-covered / `pending_migrations`) migrations. Their bodies are
 *   authoritatively superseded by the regenerated baseline — re-running an
 *   absorbed delta's older body over the corrected baseline is exactly the
 *   deferred-re-apply defect this work prevents. And re-apply of drifted
 *   deltas is OPT-IN (AISHA_DB_REAPPLY_CHANGED=1), never the default, because a
 *   deferred delta may be a data migration whose re-run would duplicate rows.
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const RUNNER_PATH = resolve(ROOT, "scripts/db/migrate.mjs");

function readRunner(): string {
  expect(existsSync(RUNNER_PATH), `expected runner at ${RUNNER_PATH}`).toBe(true);
  return readFileSync(RUNNER_PATH, "utf8");
}

describe("migrate.mjs: content-checksum drift tracking", () => {
  test("applied_migrations declares a checksum column, added in-place for legacy DBs", () => {
    const src = readRunner();
    // Column present in the tracking table + an idempotent ALTER so databases
    // created before drift tracking gain it without a manual migration.
    expect(src).toMatch(/ALTER TABLE\s+aisha_meta\.applied_migrations\s+ADD COLUMN IF NOT EXISTS\s+checksum/i);
  });

  test("checksum is a sha256 of the migration file body", () => {
    const src = readRunner();
    expect(src).toMatch(/createHash\(\s*["']sha256["']\s*\)/);
    // The checksum unit is the file body read from the migrations dir.
    expect(src).toMatch(/function\s+fileChecksum\s*\(/);
  });

  test("markApplied records the checksum and refreshes it on re-apply (DO UPDATE, not DO NOTHING)", () => {
    const src = readRunner();
    expect(src).toMatch(/INSERT INTO aisha_meta\.applied_migrations\s*\(\s*version,\s*name,\s*checksum\s*\)/i);
    expect(src).toMatch(/ON CONFLICT\s*\(version\)\s*DO UPDATE/i);
    // The old version-only "DO NOTHING" insert must be gone — it would drop the
    // refreshed checksum on a re-apply and re-introduce the blind spot.
    expect(src).not.toMatch(/applied_migrations[\s\S]{0,200}ON CONFLICT\s*\(version\)\s*DO NOTHING/i);
  });

  test("the baseline carries no checksum (it is excluded from drift; has its own reset path)", () => {
    const src = readRunner();
    expect(src).toMatch(/file\s*===\s*BASELINE_FILE\s*\?\s*null/);
  });

  test("SAFETY: drift detection excludes absorbed (baseline-covered) migrations", () => {
    const src = readRunner();
    // The key invariant: an absorbed delta (in baselineSnapshotMigrations /
    // pending_migrations) is skipped in the drift scan so its older body never
    // re-runs over the corrected baseline.
    expect(src).toMatch(/baselineSnapshotMigrations\.has\(file\)\s*\)\s*continue/);
    expect(src.toLowerCase()).toContain("absorbed");
  });

  test("legacy NULL-checksum rows are backfilled (UPDATE), never re-applied", () => {
    const src = readRunner();
    expect(src).toMatch(/UPDATE\s+aisha_meta\.applied_migrations\s+SET\s+checksum/i);
    expect(src.toLowerCase()).toContain("backfill");
  });

  test("drift is ALWAYS surfaced, and re-apply is OPT-IN (AISHA_DB_REAPPLY_CHANGED=1), not default", () => {
    const src = readRunner();
    // Always warn on drift.
    expect(src).toMatch(/body drift/i);
    // Re-apply gated behind an explicit opt-in env flag.
    expect(src).toMatch(/process\.env\.AISHA_DB_REAPPLY_CHANGED\s*===\s*["']1["']/);
    // The re-apply branch must be guarded by that flag (not unconditional).
    expect(src).toMatch(/if\s*\(\s*reapplyChanged\s*\)/);
  });

  test("drift is decided by comparing the recorded checksum against the current body", () => {
    const src = readRunner();
    expect(src).toMatch(/recorded\s*!==\s*current/);
  });
});
