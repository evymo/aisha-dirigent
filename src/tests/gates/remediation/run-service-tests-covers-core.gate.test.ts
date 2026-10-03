/**
 * Gate (remediation GW-02): the service test runner must cover the CORE services
 * that do not carry the `svc-` name prefix.
 *
 * Why this exists:
 *   scripts/test/run-service-tests.mjs auto-discovers service test suites and runs
 *   `npm --prefix <dir> test` for each. It is the executable definition of "which
 *   service suites CI runs". Its discoverServices() filters the services/ directory
 *   with `name.startsWith("svc-")`, so first-class core services that predate the
 *   naming convention — `gateway` (the JWT edge / PGRST gateway) and `storage-auth`
 *   — are silently EXCLUDED even though they ship a real vitest suite. Their tests
 *   never run in this aggregate runner: a regression in the auth gateway or storage
 *   auth path passes the gate unnoticed.
 *
 * The contract:
 *   Any service directory that QUALIFIES for the runner (has a `test` script AND a
 *   vitest config or a test file under src/tests/) must be REACHABLE by the runner's
 *   discovery — either because its name starts with `svc-` or because it is listed
 *   in an explicit CORE_SERVICES set inside run-service-tests.mjs. This is a class
 *   invariant: it catches gateway + storage-auth today and any future non-`svc-`
 *   service that grows a test suite without being added to CORE_SERVICES.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd):
 *   discoverServices() filters solely on name.startsWith("svc-") and there is no
 *   CORE_SERVICES set, so `gateway` and `storage-auth` (both with `"test": "vitest
 *   run"` and a vitest.config.ts) are unreachable.
 *
 * After the fix (introduce a CORE_SERVICES set containing at least gateway and
 * storage-auth and union it into discovery), this gate goes green. Do NOT weaken
 * the assertion — extend the runner to cover the core services.
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isTrackedService } from "../lib/tracked-services";

const ROOT = process.cwd();
const SERVICES_DIR = join(ROOT, "services");
const RUNNER = join(ROOT, "scripts", "test", "run-service-tests.mjs");

const VITEST_CONFIG_FILES = [
  "vitest.config.ts",
  "vitest.config.mjs",
  "vitest.config.js",
  "vitest.config.cjs",
];

function hasVitestConfig(svcDir: string): boolean {
  return VITEST_CONFIG_FILES.some((f) => existsSync(join(svcDir, f)));
}

function walkForPattern(dir: string, pattern: RegExp): boolean {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (walkForPattern(full, pattern)) return true;
    } else if (pattern.test(entry)) {
      return true;
    }
  }
  return false;
}

function hasTestFiles(svcDir: string): boolean {
  const testsDir = join(svcDir, "src", "tests");
  if (!existsSync(testsDir)) return false;
  return walkForPattern(testsDir, /\.(test|spec|unit\.test)\.ts$/);
}

function hasTestScript(svcDir: string): boolean {
  const pkgPath = join(svcDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg?.scripts?.test === "string";
  } catch {
    return false;
  }
}

/** Mirrors run-service-tests.mjs discoverServices() qualification predicate. */
function qualifiesForRunner(svcDir: string): boolean {
  return hasTestScript(svcDir) && (hasVitestConfig(svcDir) || hasTestFiles(svcDir));
}

/**
 * Parse the runner source to determine which non-`svc-` service basenames it can
 * reach via an explicit CORE_SERVICES set. We do NOT re-run the buggy filter; we
 * read the runner's declared intent. Any string literal appearing in a
 * `CORE_SERVICES` declaration counts as reachable.
 */
function coreServicesDeclaredByRunner(): Set<string> {
  const src = readFileSync(RUNNER, "utf-8");
  const out = new Set<string>();
  // Match: const CORE_SERVICES = new Set([ "gateway", "storage-auth" ])
  //   or:  const CORE_SERVICES = [ "gateway", ... ]
  const decl = src.match(/CORE_SERVICES\s*=\s*(?:new\s+Set\s*\(\s*)?\[([\s\S]*?)\]/);
  if (decl) {
    for (const m of decl[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
      out.add(m[1]);
    }
  }
  return out;
}

/** A service is reachable by the runner if it is `svc-`-prefixed or declared core. */
function reachableByRunner(basename: string, core: Set<string>): boolean {
  return basename.startsWith("svc-") || core.has(basename);
}

describe("GW-02: run-service-tests.mjs covers core (non-svc-) services", () => {
  test("runner source exists", () => {
    expect(existsSync(RUNNER)).toBe(true);
  });

  // The two known core services this remediation targets. They must both (a)
  // ship a real test suite and (b) be reachable by the runner.
  test.each(["gateway", "storage-auth"])(
    "core service %s ships a test suite and is reachable by the runner",
    (name) => {
      const dir = join(SERVICES_DIR, name);
      expect(existsSync(dir), `services/${name} should exist`).toBe(true);
      expect(
        qualifiesForRunner(dir),
        `services/${name} must have a test script + vitest config/test files`,
      ).toBe(true);

      const core = coreServicesDeclaredByRunner();
      expect(
        reachableByRunner(name, core),
        `run-service-tests.mjs must reach services/${name} — add it to a CORE_SERVICES set (currently discovery filters on name.startsWith("svc-") only)`,
      ).toBe(true);
    },
  );

  test("every qualifying non-svc- service is reachable by the runner (class invariant)", () => {
    const core = coreServicesDeclaredByRunner();
    const orphaned: string[] = [];
    for (const name of readdirSync(SERVICES_DIR)) {
      // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
      if (!isTrackedService(name)) continue;
      const dir = join(SERVICES_DIR, name);
      if (!statSync(dir).isDirectory()) continue;
      if (name.startsWith("svc-")) continue; // already reachable by prefix
      if (!qualifiesForRunner(dir)) continue; // no test suite => runner ignores by design
      if (!reachableByRunner(name, core)) orphaned.push(name);
    }
    expect(
      orphaned,
      `These non-svc- services have test suites the runner will never execute (add to CORE_SERVICES): ${orphaned.join(", ")}`,
    ).toEqual([]);
  });
});
