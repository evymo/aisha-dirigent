/**
 * Coolify backup integration scripts Gate
 *
 * Ověřuje:
 *   1. coolify-backup-status.mjs syntax + --help + JSON output shape
 *   2. coolify-restore-backup.sh syntax + --help + missing-arg validation
 *   3. Bez COOLIFY_API_TOKEN failují gracefully (ne crash)
 */

import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const STATUS_SCRIPT = join(ROOT, "scripts/coolify-backup-status.mjs");
const RESTORE_SCRIPT = join(ROOT, "scripts/coolify-restore-backup.sh");

function isExecutable(path: string): boolean {
  try { return (statSync(path).mode & 0o111) !== 0; } catch { return false; }
}

describe("coolify-backup-status.mjs", () => {
  test("script exists and is executable", () => {
    expect(existsSync(STATUS_SCRIPT)).toBe(true);
    expect(isExecutable(STATUS_SCRIPT)).toBe(true);
  });

  test("node --check syntax passes", () => {
    const r = spawnSync("node", ["--check", STATUS_SCRIPT], { encoding: "utf-8" });
    expect(r.status).toBe(0);
  });

  test("--help exits 0", () => {
    const r = spawnSync("node", [STATUS_SCRIPT, "--help"], {
      encoding: "utf-8",
      env: { ...process.env, COOLIFY_API_TOKEN: "fake" },
      timeout: 5000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/coolify-backup-status\.mjs/i);
  });

  test("graceful fail on missing token (no crash, exit 1)", () => {
    const r = spawnSync("node", [STATUS_SCRIPT], {
      encoding: "utf-8",
      env: {
        ...process.env,
        COOLIFY_API_TOKEN: "",
        COOLIFY_API_KEY: "",
        // COOLIFY_URL must be set (no in-script default per iter 10
        // template-only directive); supply a placeholder so the script
        // proceeds past the URL guard to the token-load step we're testing.
        COOLIFY_URL: "https://coolify.invalid",
        COOLIFY_BASE_URL: "",
        HOME: "/tmp",
        // Isolate from real .env-prod-backup (exists in main repo)
        AISHA_PROD_BACKUP_FILE: "/dev/null",
      },
      cwd: "/tmp",  // away from .env-prod-backup
      timeout: 5000,
    });
    // Without token, loadToken() throws → main catches → exit 1.
    expect(r.status).toBe(1);
  });
});

describe("coolify-restore-backup.sh", () => {
  test("script exists and is executable", () => {
    expect(existsSync(RESTORE_SCRIPT)).toBe(true);
    expect(isExecutable(RESTORE_SCRIPT)).toBe(true);
  });

  test("bash -n syntax passes", () => {
    const r = spawnSync("bash", ["-n", RESTORE_SCRIPT], { encoding: "utf-8" });
    expect(r.status).toBe(0);
  });

  test("--help exits 0", () => {
    const r = spawnSync("bash", [RESTORE_SCRIPT, "--help"], {
      encoding: "utf-8",
      env: { ...process.env, COOLIFY_API_KEY: "fake" },
      timeout: 5000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/coolify-restore-backup\.sh/);
  });

  test("missing db name fails with non-zero exit", () => {
    const r = spawnSync("bash", [RESTORE_SCRIPT], {
      encoding: "utf-8",
      env: { ...process.env, COOLIFY_API_KEY: "fake" },
      timeout: 5000,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/missing database name/);
  });

  test("unknown option fails", () => {
    const r = spawnSync("bash", [RESTORE_SCRIPT, "--bogus"], {
      encoding: "utf-8",
      env: { ...process.env, COOLIFY_API_KEY: "fake" },
      timeout: 5000,
    });
    expect(r.status).not.toBe(0);
  });
});
