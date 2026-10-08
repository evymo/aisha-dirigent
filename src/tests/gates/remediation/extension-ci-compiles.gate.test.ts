/**
 * GATE: CI build steps must invoke a script that actually exists.
 *
 * CONTRACT
 * --------
 * A CI job whose purpose is to BUILD/compile a package must run a script that
 * really exists in that package's package.json. `npm run <x> --if-present`
 * SILENTLY SUCCEEDS (no-op, exit 0) when `<x>` is absent — so a "Build" step
 * that references a non-existent script is a green lie: the bundle is never
 * produced and a broken extension ships.
 *
 * The VS Code extension `extensions/aisha-dirigent` is bundled by esbuild via
 * `npm run compile` (package.json). It has NO `build` script. The
 * `test-extension` job in .github/workflows/ci.yml ran
 * `npm run build --if-present` — a no-op — so the extension bundle was never
 * compiled or verified in CI.
 *
 * KNOWN-RED (HEAD 569c5ffd): ci.yml:~550 `Build` step runs
 *   `npm run build --if-present`
 * against a package that has `compile` but not `build`.
 *
 * POST-FIX (GREEN): the step must invoke `npm run compile` (a real, bundling
 * script) — not the no-op `--if-present` on a missing script.
 *
 * This is a PATTERN gate: it walks EVERY job in ci.yml that declares a
 * working-directory, resolves that package's package.json, and asserts no
 * build/compile step references a script absent from that package via
 * `--if-present`. That way it also catches any overlooked sibling job with the
 * same no-op-build defect.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const CI_YML = path.join(REPO_ROOT, ".github/workflows/ci.yml");

/** Steps whose intent is to produce a build artifact. */
const BUILD_SCRIPT_NAMES = new Set(["build", "compile"]);

interface Step {
  name?: string;
  run?: string;
  "working-directory"?: string;
}
interface Job {
  defaults?: { run?: { "working-directory"?: string } };
  steps?: Step[];
}

/** Parse `npm run <script>` invocations (with/without --if-present) out of a run block. */
function parseNpmRunScripts(run: string): { script: string; ifPresent: boolean; raw: string }[] {
  const out: { script: string; ifPresent: boolean; raw: string }[] = [];
  for (const line of run.split("\n")) {
    const m = line.match(/npm\s+run\s+([A-Za-z0-9:_-]+)((?:\s+--if-present)?)/);
    if (m) out.push({ script: m[1], ifPresent: /--if-present/.test(m[2]), raw: line.trim() });
  }
  return out;
}

function loadPackageScripts(pkgDir: string): Record<string, string> | null {
  const pkgPath = path.join(REPO_ROOT, pkgDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.scripts ?? {};
}

describe("GATE: CI build/compile steps must reference a real script", () => {
  const doc = yaml.load(fs.readFileSync(CI_YML, "utf8")) as { jobs?: Record<string, Job> };
  const jobs = doc.jobs ?? {};

  it("ci.yml parses and defines jobs", () => {
    expect(Object.keys(jobs).length).toBeGreaterThan(0);
  });

  it("no build/compile step is a silent no-op against a missing package script", () => {
    const offenders: string[] = [];

    for (const [jobName, job] of Object.entries(jobs)) {
      const jobWd = job.defaults?.run?.["working-directory"];
      for (const step of job.steps ?? []) {
        if (!step.run) continue;
        const wd = step["working-directory"] ?? jobWd;
        if (!wd) continue; // repo-root steps: package.json ambiguous, skip.
        const scripts = loadPackageScripts(wd);
        if (scripts === null) continue; // no package.json at that dir.

        for (const { script, ifPresent, raw } of parseNpmRunScripts(step.run)) {
          const isBuildIntent =
            BUILD_SCRIPT_NAMES.has(script) ||
            /^(build|compile)$/i.test((step.name ?? "").trim());
          if (!isBuildIntent) continue;
          // A build-intent step must invoke a script that EXISTS.
          if (!(script in scripts)) {
            offenders.push(
              `job "${jobName}" (wd=${wd}) step "${step.name ?? "?"}": ` +
                `\`${raw}\`${ifPresent ? " (--if-present ⇒ silent no-op)" : ""} — ` +
                `script "${script}" is absent from ${wd}/package.json ` +
                `(available: ${Object.keys(scripts).join(", ")})`,
            );
          }
        }
      }
    }

    expect(offenders, `CI build steps that never build:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("test-extension job actually compiles the extension bundle", () => {
    const job = jobs["test-extension"];
    expect(job, "test-extension job must exist in ci.yml").toBeTruthy();

    const wd = job.defaults?.run?.["working-directory"];
    expect(wd).toBe("extensions/aisha-dirigent");

    const scripts = loadPackageScripts(wd!);
    expect(scripts, "extension package.json must have scripts").toBeTruthy();
    // Ground truth: the extension bundles via `compile`, not `build`.
    expect(scripts).toHaveProperty("compile");

    const runLines = (job.steps ?? []).flatMap((s) => (s.run ? [s.run] : []));
    const allScripts = runLines.flatMap((r) => parseNpmRunScripts(r).map((p) => p.script));

    // Must run the real bundling script.
    expect(
      allScripts,
      `test-extension must run \`npm run compile\`; found: ${allScripts.join(", ")}`,
    ).toContain("compile");
  });
});
