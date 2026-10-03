/**
 * Baseline trigger-parity gate
 *
 * Every trigger source-of-truth file (aisha/db/sql/triggers/*.sql) that declares
 * a CREATE TRIGGER under a "-- Trigger:" header MUST appear in the compiled
 * baseline (aisha/db/migrations/00000000000000_baseline.sql) — which
 * scripts/db/migrate.mjs applies AS-IS to a fresh database (there is no
 * deploy-time regeneration).
 *
 * Why this exists (2026-07-25):
 *   scripts/db/generate-init-migration-from-sources.mjs extracted the trigger
 *   name with a comment-insensitive regex, so a leading "-- Create trigger"
 *   header line let the regex match the comment and capture "CREATE" from the
 *   real statement on the next line as the trigger NAME. Every such file
 *   collapsed onto the bogus dedup key "create" and all but one were dropped —
 *   silently losing on_auth_user_created (the member-provisioning trigger that
 *   fires handle_new_user) plus 9 others from the baseline. A fresh instance
 *   then never provisioned a role/profile for new signups. The generator now
 *   strips comments before extraction; this gate keeps it fixed.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TRIG_DIR = join(ROOT, "aisha/db/sql/triggers");
const BASELINE = join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");

/** Trigger names in a SQL blob, ignoring full-line SQL comments (the bug's root). */
function triggerNames(sql: string): string[] {
  const code = sql.replace(/^[ \t]*--.*$/gm, "");
  return [...code.matchAll(/CREATE\s+TRIGGER\s+("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi)].map((m) =>
    m[1].replace(/^"|"$/g, ""),
  );
}

describe("baseline trigger parity", () => {
  test("every source-of-truth trigger is folded into the compiled baseline", () => {
    expect(existsSync(TRIG_DIR)).toBe(true);
    expect(existsSync(BASELINE)).toBe(true);

    const baselineTriggers = new Set(triggerNames(readFileSync(BASELINE, "utf8")).map((n) => n.toLowerCase()));

    const missing: string[] = [];
    for (const file of readdirSync(TRIG_DIR).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(TRIG_DIR, file), "utf8");
      if (!sql.includes("-- Trigger:")) continue; // same marker the generator gates on
      for (const name of triggerNames(sql)) {
        if (!baselineTriggers.has(name.toLowerCase())) missing.push(`${name} (${file})`);
      }
    }

    expect(
      missing,
      `SoT triggers missing from the compiled baseline — regenerate via \`npm run db:init:generate\`: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
