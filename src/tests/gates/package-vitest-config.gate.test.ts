/**
 * Package vitest-config gate — inherited-setupFiles crash prevention.
 *
 * A workspace package under `packages/*` whose `"test"` script runs vitest but
 * which has NO vitest config of its own inherits the ROOT `vitest.config.ts`,
 * whose `setupFiles: ["./src/test/setup.ts"]` resolves RELATIVE TO THE PACKAGE
 * CWD — i.e. `packages/<name>/src/test/setup.ts`, which does not exist. Vitest
 * then fails to load the whole suite:
 *     Error: Cannot find module '.../packages/<name>/src/test/setup.ts'
 *
 * This shipped in #678 (packages/acs-sdk + packages/acs-contracts) — the tests
 * existed and passed logically, but never ran because the suite could not load.
 * Every sibling package (security, aitg, audience-types, …) carries a
 * self-contained `vitest.config.ts`; this gate makes that mandatory so no future
 * package silently ships un-runnable tests.
 *
 * Runs via: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, "packages");
const CONFIG_NAMES = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.cts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vitest.config.cjs",
  "vitest.workspace.ts",
];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

function hasTestFile(dir: string): boolean {
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && hasTestFile(path.join(dir, entry.name))) return true;
    } else if (/\.(test|spec)\.[cm]?ts$/.test(entry.name)) {
      return true;
    }
  }
  return false;
}

describe("Package vitest config (inherited-setupFiles crash prevention)", () => {
  it("every packages/* that runs vitest AND ships tests has its own vitest config", () => {
    const violations: string[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(PKG_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
        .map((e) => e.name);
    } catch {
      names = [];
    }

    for (const name of names) {
      const dir = path.join(PKG_DIR, name);
      const pkgJson = path.join(dir, "package.json");
      if (!existsSync(pkgJson)) continue;

      let testScript = "";
      try {
        testScript = (JSON.parse(readFileSync(pkgJson, "utf-8")).scripts ?? {}).test ?? "";
      } catch {
        continue;
      }
      if (!/\bvitest\b/.test(testScript)) continue; // package does not run vitest
      if (!hasTestFile(dir)) continue; // no tests to break

      const hasConfig = CONFIG_NAMES.some((c) => existsSync(path.join(dir, c)));
      if (!hasConfig) {
        violations.push(`packages/${name} — "test": "${testScript}" runs vitest but has no vitest.config.*`);
      }
    }

    expect(
      violations,
      `A package that runs vitest without its own config inherits the root config's\n` +
        `setupFiles (./src/test/setup.ts), which resolves to <package>/src/test/setup.ts\n` +
        `— nonexistent — so the suite fails to LOAD (tests never run). Add a self-contained\n` +
        `vitest.config.ts (mirror packages/security/vitest.config.ts). Offenders:\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([]);
  });
});
