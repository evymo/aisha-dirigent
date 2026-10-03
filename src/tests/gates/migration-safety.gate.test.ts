/**
 * Migration Safety Gate — static prod-safety lint of delta migrations (Squawk)
 *
 * The migration-safety half of the DB-quality lens (companion to the catalog-based
 * FK-relationship gate). Runs scripts/db/check-migration-safety.mjs, which lints
 * aisha/db/migrations/*.sql with Squawk (https://squawkhq.com) for DDL that locks or
 * breaks prod — CREATE INDEX without CONCURRENTLY, dropping columns/tables, renames,
 * NOT NULL adds, FK adds without NOT VALID, etc. Rule selection lives in .squawk.toml;
 * pre-existing smells are snapshotted in migration-safety.allowlist.json. The gate fails
 * only on a NEW (file::rule::line) violation — migrations are append-only.
 *
 * Squawk is a pinned devDependency (squawk-cli); the wrapper falls back to npx if absent.
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "scripts/db/check-migration-safety.mjs");
const ALLOWLIST = resolve(ROOT, "src/tests/gates/migration-safety.allowlist.json");
const CONFIG = resolve(ROOT, ".squawk.toml");

describe("Migration Safety Gate (squawk)", () => {
  test(".squawk.toml + wrapper + allowlist all exist", () => {
    expect(existsSync(CONFIG), `expected .squawk.toml at ${CONFIG}`).toBe(true);
    expect(existsSync(SCRIPT), `expected wrapper at ${SCRIPT}`).toBe(true);
    expect(existsSync(ALLOWLIST), `expected allowlist at ${ALLOWLIST}`).toBe(true);
  });

  test("allowlist is well-formed (identity-keyed entries)", () => {
    const j = JSON.parse(readFileSync(ALLOWLIST, "utf-8"));
    expect(Array.isArray(j.allowlist)).toBe(true);
    for (const e of j.allowlist) {
      expect(typeof e.file).toBe("string");
      expect(typeof e.rule).toBe("string");
      expect(typeof e.line).toBe("number");
    }
  });

  test("no NEW unsafe DDL beyond the baseline", () => {
    try {
      execFileSync("node", [SCRIPT], { cwd: ROOT, stdio: "pipe", encoding: "utf-8" });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message || "unknown failure";
      throw new Error(`migration-safety gate failed (new unsafe DDL, or squawk unavailable):\n${out}`);
    }
  });
});
