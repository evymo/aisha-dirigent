/**
 * Gate (remediation W1-tsconfig-app-real): the primary TypeScript type-check
 * must compile the REAL app config, not a no-op.
 *
 * Why this exists: the repo's root `tsconfig.json` declares `"files": []` (it is
 * a solution-style aggregator that references tsconfig.app.json / tsconfig.node
 * .json via project refs). Running `tsc --noEmit` against that root config
 * therefore type-checks ZERO files — it is a green no-op that silently hides
 * every type error in `src/`. The config that actually includes the app source
 * (`"include": ["src"]`) is `tsconfig.app.json`. The type-check gate MUST target
 * it explicitly with `-p tsconfig.app.json`.
 *
 * Two enforcement surfaces:
 *   1. package.json `type-check` (consumed transitively by `typecheck:repo`)
 *      must be `tsc --noEmit -p tsconfig.app.json`.
 *   2. .github/workflows/ci.yml — any TypeScript step that runs `tsc --noEmit`
 *      at the REPO ROOT (i.e. in a job with no `working-directory` override, so
 *      it resolves the root tsconfig.json no-op) must pass
 *      `-p tsconfig.app.json`. Jobs that set a `working-directory` (n8n nodes,
 *      extension) legitimately compile their own package's tsconfig and are not
 *      in scope.
 *
 * KNOWN-RED at authoring time (branch feat/remediation, HEAD 569c5ffd):
 *   - package.json `type-check` = "tsc --noEmit"           (→ root tsconfig, files:[])
 *   - ci.yml `check-web` job runs "npx tsc --noEmit"       (no -p, repo root)
 * Both resolve the empty root config and check nothing. The real
 * `tsconfig.app.json` compile currently surfaces ~739 errors — precisely what
 * this no-op was hiding. This gate does a STATIC assert only; it never invokes
 * the compiler.
 *
 * After the fix (add `-p tsconfig.app.json` to both surfaces) this gate goes
 * green. Do NOT weaken the assertion to match the buggy no-op — wire the flag.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APP_PROJECT_FLAG = /-p\s+(\.\/)?tsconfig\.app\.json\b/;

/** Reads a repo-relative text file. */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("type-check targets the real app tsconfig (not the files:[] no-op)", () => {
  test("root tsconfig.json is a no-op aggregator (files:[]), so -p is required elsewhere", () => {
    // Documents the precondition that makes a bare `tsc --noEmit` meaningless.
    const root = JSON.parse(read("tsconfig.json"));
    expect(
      Array.isArray(root.files) && root.files.length === 0,
      "Precondition changed: tsconfig.json no longer has files:[]. If the root " +
        "config now compiles src directly, revisit this gate's contract.",
    ).toBe(true);
  });

  test("tsconfig.app.json is the config that actually includes app source", () => {
    const app = JSON.parse(read("tsconfig.app.json"));
    expect(
      JSON.stringify(app.include ?? []),
      "tsconfig.app.json must include the app source tree (src).",
    ).toContain("src");
  });

  test("package.json `type-check` compiles tsconfig.app.json explicitly", () => {
    const pkg = JSON.parse(read("package.json"));
    const script: string = pkg.scripts?.["type-check"] ?? "";
    expect(script, "package.json is missing a `type-check` script").not.toBe("");
    expect(
      APP_PROJECT_FLAG.test(script),
      `package.json "type-check" must pass -p tsconfig.app.json (not the root ` +
        `no-op tsconfig.json). Found: "${script}"`,
    ).toBe(true);
  });

  test("every repo-root `tsc --noEmit` step in ci.yml passes -p tsconfig.app.json", () => {
    const CI = ".github/workflows/ci.yml";
    const yaml = read(CI);
    const lines = yaml.split("\n");

    // Match top-level job headers: two-space indent, `<name>:`.
    const jobHeader = /^ {2}([A-Za-z0-9_-]+):\s*$/;

    type TscStep = { line: number; run: string; job: string; rootScoped: boolean };
    const steps: TscStep[] = [];

    // Walk lines, tracking the enclosing job and whether that job (up to the
    // current line) has declared a `working-directory` (which re-scopes tsc to
    // a sub-package tsconfig and takes it out of scope for this contract).
    let currentJob = "(root)";
    let jobStart = 0;

    const jobHasWorkingDir = (fromLine: number, toLine: number): boolean => {
      for (let i = fromLine; i <= toLine && i < lines.length; i++) {
        if (/^\s*working-directory:\s*\S/.test(lines[i])) return true;
      }
      return false;
    };

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(jobHeader);
      if (m) {
        currentJob = m[1];
        jobStart = i;
        continue;
      }
      // `run: ... tsc --noEmit ...` (single-line form used throughout ci.yml).
      if (/\brun:\s.*\btsc\s+--noEmit\b/.test(lines[i])) {
        const run = lines[i].trim();
        steps.push({
          line: i + 1,
          run,
          job: currentJob,
          rootScoped: !jobHasWorkingDir(jobStart, i),
        });
      }
    }

    // Sanity: the gate is only meaningful if it actually found the tsc steps.
    expect(
      steps.length,
      "Found no `tsc --noEmit` steps in ci.yml — parser or workflow changed.",
    ).toBeGreaterThan(0);

    const rootScoped = steps.filter((s) => s.rootScoped);
    expect(
      rootScoped.length,
      "Expected at least one repo-root tsc step (the app type-check).",
    ).toBeGreaterThan(0);

    const offenders = rootScoped.filter((s) => !APP_PROJECT_FLAG.test(s.run));
    expect(
      offenders,
      "ci.yml repo-root TypeScript steps that omit -p tsconfig.app.json " +
        "(they compile the files:[] root no-op and check nothing):\n" +
        offenders
          .map((o) => `  ${CI}:${o.line} [job ${o.job}] -> ${o.run}`)
          .join("\n"),
    ).toEqual([]);
  });
});
