/**
 * Seed layer profile gate
 *
 * Verifies the behavior of scripts/db/compile-seed.mjs instead of only locking
 * comments/regexes. Dry-runs are non-mutating and expose the selected sections.
 */
import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function compileDryRun(args: string[] = []): string {
  return execFileSync("node", ["scripts/db/compile-seed.mjs", ...args, "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
}

/** Dry-run capturing stdout + stderr + exit status (for warning/fail assertions). */
function compileDryRunResult(args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync("node", ["scripts/db/compile-seed.mjs", ...args, "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** True when the private-instance submodule is populated in this checkout. */
function instanceOverlayPopulated(): boolean {
  try {
    return readdirSync(join(ROOT, "aisha/db/seed/instance")).some((f) => f.endsWith(".sql"));
  } catch {
    return false;
  }
}

const INSTANCE_ABSENT_WARNING = "private instance overlay requested but absent";

describe("seed compiler layer profiles", () => {
  test("default profile is public-safe platform", () => {
    const out = compileDryRun();
    expect(out).toContain("profile: platform");
    expect(out).toContain("core/");
    expect(out).toContain("translations/");
    expect(out).not.toContain("implementation:aisha/");
    expect(out).not.toContain("private-instance/");
    expect(out).not.toContain("demo/");
  });

  test("empty is a legacy alias for platform", () => {
    const out = compileDryRun(["--profile", "empty"]);
    expect(out).toContain("profile: platform");
    expect(out).not.toContain("implementation:aisha/");
    expect(out).not.toContain("demo/");
  });

  test("dev includes the dev fixtures layer and excludes demo/implementation/private", () => {
    // The local dev/test stack default (warmup:local --seed-profile dev). Dev
    // fixtures are committed + FK-safe; demo data must NOT leak in (demo is for
    // demo only).
    const out = compileDryRun(["--profile", "dev"]);
    expect(out).toContain("profile: dev");
    expect(out).toContain("core/");
    expect(out).toContain("dev/");
    expect(out).not.toContain("demo/");
    expect(out).not.toContain("implementation:aisha/");
    expect(out).not.toContain("private-instance/");
  });

  test("demo includes public demo and excludes implementation/private overlay", () => {
    const out = compileDryRun(["--profile", "demo", "--implementation", "aisha"]);
    expect(out).toContain("profile: demo");
    expect(out).toContain("demo/");
    expect(out).not.toContain("implementation:aisha/");
    expect(out).not.toContain("private-instance/");
    expect(out).not.toContain("dev/");
  });

  test("implementation includes only the selected implementation layer", () => {
    const out = compileDryRun(["--profile", "implementation", "--implementation", "aisha"]);
    expect(out).toContain("profile: implementation");
    expect(out).toContain("implementation:aisha/");
    expect(out).toContain("05_our_aisha_default_story.sql");
    expect(out).not.toContain("private-instance/");
    expect(out).not.toContain("demo/");
  });

  test("instance includes implementation and private overlay, excluding demo", () => {
    const out = compileDryRun(["--profile", "instance", "--implementation", "aisha"]);
    expect(out).toContain("profile: instance");
    expect(out).toContain("implementation:aisha/");
    expect(out).not.toContain("demo/");
  });

  test("full includes implementation and demo", () => {
    const out = compileDryRun(["--profile", "full", "--implementation", "aisha"]);
    expect(out).toContain("profile: full");
    expect(out).toContain("implementation:aisha/");
    expect(out).toContain("demo/");
  });

  // ── Unpopulated private-instance submodule (README-only) ──────────────────
  // When `instance`/`full` is requested but the submodule is just a placeholder,
  // the compile must fall back to the DEFAULT layers — loudly, not silently.
  test("instance overlay absent → explicit warning + default-layer fallback (never silent)", () => {
    const res = compileDryRunResult(["--profile", "instance", "--implementation", "aisha"]);
    expect(res.status).toBe(0); // still produces a usable (default) seed
    // Dry-run stdout lists selected sections as "📁 <name>/" — the
    // "SECTION: <NAME>" banner exists only inside the compiled SQL content,
    // which --dry-run never prints.
    if (instanceOverlayPopulated()) {
      expect(res.stderr).not.toContain(INSTANCE_ABSENT_WARNING);
      // dry-run prints the per-section file listing, not the compiled SQL —
      // the "📁 private-instance/" line only prints when the section has files,
      // so it is the dry-run proof that the populated overlay was compiled in.
      expect(res.stdout).toContain("private-instance/");
    } else {
      expect(res.stderr).toContain(INSTANCE_ABSENT_WARNING);
      expect(res.stdout).not.toContain("private-instance/");
    }
  });

  test("platform/default profile never emits the instance-absent warning", () => {
    expect(compileDryRunResult().stderr).not.toContain(INSTANCE_ABSENT_WARNING);
  });

  test("AISHA_SEED_REQUIRE_INSTANCE=1 fails closed only when the overlay is absent", () => {
    const res = compileDryRunResult(["--profile", "instance", "--implementation", "aisha"], {
      AISHA_SEED_REQUIRE_INSTANCE: "1",
    });
    if (instanceOverlayPopulated()) {
      expect(res.status).toBe(0);
    } else {
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("refusing to compile a degraded instance seed");
    }
  });
});
