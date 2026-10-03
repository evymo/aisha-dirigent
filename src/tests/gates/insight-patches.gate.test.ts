/**
 * Insight Patches Gate
 *
 * Enforce vendoring-with-patches contract pro packages/insight submodule:
 *
 *   1. Default gate is read-only: patches must be already applied or cleanly
 *      applicable against the current submodule state.
 *
 *   2. Všechny patche v aisha/insight-patches/*.patch cleanly aplikují
 *      proti aktuálnímu pinnému submodule commitu (přes scripts/insight-
 *      patches-apply.sh --check).
 *
 *   3. Každý patch má header `# Target: aisha/insight@<sha>` matching
 *      pinný commit submodulu (zabrání tichému driftu mezi pin a patch
 *      target — upgrade workflow musí synchronně updatnout obojí).
 *
 * Spouští se přes:
 *   - npm run test:gates           # read-only
 *   - npm run test:gates:mutation  # opt-in reset/reapply contract
 *
 * Pokud upstream se posunul a patches už neaplikují, gate failne s konkrétní
 * instrukcí na upgrade workflow (viz aisha/insight-patches/README.md).
 */

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { insightNeedsValidation } from "../../../scripts/lib/insight-validation.mjs";

const ROOT = process.cwd();
const SUBMODULE = join(ROOT, "packages/insight");
// The insight submodule is fetched from github.com, which the self-hosted CI
// runner cannot reach — it is checked out WITHOUT submodules there. The
// pin↔patch-header consistency test uses `git ls-tree` (gitlink only) and ALWAYS
// runs. The "patches apply cleanly to the content" check needs the working tree;
// it is CONDITIONALLY REQUIRED: it must run (fail-if-absent) whenever this change
// touches insight — i.e. the current (pin, patches) differs from the recorded
// attestation (aisha/insight-patches/.insight-validated.json). When insight is
// unchanged, the prior attestation still holds, so a content-absent environment
// may skip it — never the changed case (no skipping a changed-insight validation).
const HAVE_INSIGHT = existsSync(join(SUBMODULE, ".git")) || existsSync(join(SUBMODULE, "maestro", "Pipfile"));
const NEEDS_VALIDATION = insightNeedsValidation(ROOT);
const PATCHES = join(ROOT, "aisha/insight-patches");
const APPLIER = join(ROOT, "scripts/insight-patches-apply.sh");
const ALLOW_MUTATION = process.env.AISHA_INSIGHT_MUTATION_GATES === "1";

// Bez zděděné git lokace: `runGit(…, SUBMODULE)` pod hookem jinak měřil
// NADŘAZENÉ repo (GIT_DIR z husky vyhraje nad `cwd`) — `status --porcelain`
// submodulu hlásil stav superprojektu. Viz git-v-testech-bez-prostredi.
function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: envWithoutGitLocation() });
}

function runApplier(mode?: "--check" | "--reset"): void {
  const args = mode ? [APPLIER, mode] : [APPLIER];
  execFileSync("bash", args, { cwd: ROOT, stdio: "pipe" });
}

function pinnedCommit(): string {
  // Read the submodule's pinned commit from the PARENT repo's submodule pointer,
  // not by entering the submodule directory and running `git rev-parse HEAD`.
  //
  // The parent-repo approach is race-free: `git ls-tree HEAD packages/insight`
  // reads the gitlink object that records the pinned SHA at the parent commit
  // level. It works whether the submodule is initialised, partially checked
  // out, or empty.
  //
  // The previous `cd submodule && git rev-parse HEAD` approach was brittle
  // under parallel test execution (e.g., husky pre-push with nvm-switched
  // Node + vitest worker pool): when several tests touched git state
  // concurrently, the submodule's HEAD lookup sometimes fell through to the
  // PARENT repo HEAD via gitlink resolution, producing a false "drift"
  // failure. This `ls-tree` version doesn't depend on the submodule
  // directory's git state at all.
  //
  // `ls-tree` output for a gitlink entry is:
  //   `160000 commit <sha>\tpackages/insight`
  const out = runGit(["ls-tree", "HEAD", "packages/insight"], ROOT).trim();
  const match = out.match(/^160000\s+commit\s+([a-f0-9]{40})\s/);
  if (!match) {
    throw new Error(`Could not parse submodule pin from \`git ls-tree HEAD packages/insight\`: ${out}`);
  }
  return match[1];
}

function listPatches(): string[] {
  if (!existsSync(PATCHES)) return [];
  return readdirSync(PATCHES)
    .filter((f) => f.endsWith(".patch"))
    .sort();
}

describe("Insight Patches Gate", () => {
  test.skipIf(!HAVE_INSIGHT)("submodule packages/insight is initialized", () => {
    expect(existsSync(SUBMODULE)).toBe(true);
    // .git can be a file (gitlink) for submodules; existence is what matters
    expect(existsSync(join(SUBMODULE, ".git"))).toBe(true);
  });

  test("patches cleanly apply against pinned content — required when insight changed", () => {
    if (listPatches().length === 0) return;
    if (HAVE_INSIGHT) {
      // Full checkout: validate the patches apply AND require the attestation to be
      // current (forces `npm run insight:revalidate` after any pin/patch bump).
      expect(() => runApplier("--check")).not.toThrow();
      expect(
        NEEDS_VALIDATION,
        "insight pin/patches changed — run `npm run insight:revalidate` to re-record aisha/insight-patches/.insight-validated.json after validating",
      ).toBe(false);
    } else if (NEEDS_VALIDATION) {
      // Content absent AND insight changed → must NOT be skipped: the patch-apply
      // validation has to run against real content.
      throw new Error(
        "insight pin or patches changed but packages/insight is absent — check out the submodule " +
          "(`git submodule update --init --recursive`) to validate the patches apply, then " +
          "`npm run insight:revalidate`. A changed-insight state is never skipped.",
      );
    }
    // else: content absent AND unchanged since the attestation → validated earlier; safe to skip.
  });

  test.each(listPatches())(
    "patch %s has Target: header matching pinned submodule commit",
    (name) => {
      const content = readFileSync(join(PATCHES, name), "utf-8");
      const targetMatch = content.match(/^#\s*Target:\s*aisha\/insight@([a-f0-9]{7,40})/m);
      expect(
        targetMatch,
        `${name} missing "# Target: aisha/insight@<sha>" metadata header`,
      ).not.toBeNull();
      const targetSha = targetMatch![1];
      const pinned = pinnedCommit();
      // Allow short-sha match: target needs to be a prefix of pinned commit (or equal).
      expect(
        pinned.startsWith(targetSha),
        `${name} target sha ${targetSha} does not match pinned ${pinned} — ` +
          `update header after submodule bump (see aisha/insight-patches/README.md)`,
      ).toBe(true);
    },
  );
});

describe.skipIf(!ALLOW_MUTATION)("Insight Patches Gate — reset/apply mutation", () => {
  test("after reset+reapply, only declared patch files are modified", () => {
    // Applier's --reset clears WD then re-applies patches. Resulting modified
    // files MUST match what patches declare — žádný silent drift between WD
    // a declared patch state. Tracks tracked-file modifications (M flag).
    runApplier("--reset");
    const status = runGit(["status", "--porcelain"], SUBMODULE);
    const trackedModified = status
      .split("\n")
      .filter((line) => /^.M\s/.test(line))
      .map((line) => line.slice(3).trim())
      .sort();

    // Build expected set from patches (parse `+++ b/<path>` lines from each).
    const expected = new Set<string>();
    for (const patchName of listPatches()) {
      const content = readFileSync(join(PATCHES, patchName), "utf-8");
      for (const m of content.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
        expected.add(m[1]);
      }
    }
    // Filter out new files (only check tracked-modified — new files show as ?? not M).
    const expectedTracked = [...expected]
      .filter((path) => existsSync(join(SUBMODULE, path)))
      .filter((path) => {
        // Exclude paths that were created BY the patch (didn't exist pre-patch).
        // Heuristic: if patch contains `new file mode`, that file was created.
        return !listPatches().some((pn) => {
          const c = readFileSync(join(PATCHES, pn), "utf-8");
          const newFileRegex = new RegExp(`diff --git a/${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} b/${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?new file mode`);
          return newFileRegex.test(c);
        });
      })
      .sort();

    expect(trackedModified).toEqual(expectedTracked);
  });

  test("all patches apply cleanly against pinned commit", () => {
    if (listPatches().length === 0) return; // no patches to verify
    runApplier("--reset");
    expect(() => runApplier("--check")).not.toThrow();
  });

  test("apply is idempotent — second invocation after apply is a no-op", () => {
    if (listPatches().length === 0) return;
    runApplier("--reset");
    runApplier();
    expect(() => runApplier()).not.toThrow();
  });
});
