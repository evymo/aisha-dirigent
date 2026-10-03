/**
 * The service input set comes from git, not from the filesystem
 *
 * WHY (false gate failure 2026-07-30):
 *   `services/svc-webdispecink` was removed from the repo by df25a389 ("fleet vendors
 *   become plugins, not services", 2026-07-26). A working tree still held its build
 *   leftovers — `dist/` + `node_modules/`, no `src/`, nothing tracked. Gates enumerated
 *   services with `readdirSync('services')`, so the OWASP adoption gate read that residue
 *   as a real service and failed all four of its checks. `npm run test:gates` went red and
 *   the pre-push hook blocked EVERY push, on a branch that touched no service code. CI on
 *   a clean checkout was green, so only the developer holding the leftover ever saw it.
 *
 *   These tests are hermetic: they build a throwaway git repo rather than asserting
 *   anything about THIS one, so they keep testing the property after the leftover that
 *   prompted them is long gone.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { trackedServiceNames, isTrackedService } from "./lib/tracked-services";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

let repo: string;
let emptyRepo: string;
let notARepo: string;

/**
 * ⚠️ Prostředí BEZ git lokace — jinak `git init` nad tmpdirem přenastaví
 * SKUTEČNÝ repozitář.
 *
 * MĚŘENO 2026-08-05: každý git hook exportuje `GIT_DIR`. Se zděděným
 * prostředím proto `git init` v `cwd` ten adresář ignoruje a pracuje nad
 * `GIT_DIR` — a protože k němu v tom volání nepatří pracovní strom, zapíše do
 * SDÍLENÉHO configu `core.bare = true`.
 *
 * Následek je vidět až jinde: `git grep` a `git ls-files` končí „must be run in
 * a work tree", takže spadnou brány, které si univerzum hledají přes git
 * (legacy-domains, dockerignore-vs-dockerfile-copy, anthropic-body-builder) —
 * tři cizí brány padaly kvůli téhle jedné. Samostatně přitom sada projde
 * zeleně, protože bez hooku žádné `GIT_DIR` není. A protože ten config je
 * sdílený, rozbije to i ostatní worktrees a session, ne jen běžící push.
 *
 * Táž třída jako v scripts/lib/git-worktree-health.mjs; helper je proto
 * společný, ne opsaný.
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", env: envWithoutGitLocation() });
}

function writeFile(root: string, rel: string, body: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

beforeAll(() => {
  // A repo with one REAL service and one leftover that only exists on disk.
  repo = mkdtempSync(join(tmpdir(), "tracked-services-"));
  git(repo, "init", "-q");
  writeFile(repo, "services/svc-real/src/index.ts", "export const x = 1;\n");
  writeFile(repo, "services/svc-real/package.json", "{}\n");
  git(repo, "add", "services/svc-real");
  // The phantom: build output from a service that no longer exists in the repo.
  // Deliberately given a package.json too — several gates filter on that, and the
  // point is that NO filesystem-shaped condition can tell residue from a service.
  writeFile(repo, "services/svc-phantom/dist/server.js", "module.exports = {};\n");
  writeFile(repo, "services/svc-phantom/package.json", '{"name":"svc-phantom"}\n');

  // A repo that tracks nothing under services/.
  emptyRepo = mkdtempSync(join(tmpdir(), "tracked-services-empty-"));
  git(emptyRepo, "init", "-q");
  writeFile(emptyRepo, "README.md", "# no services\n");
  git(emptyRepo, "add", "README.md");

  notARepo = mkdtempSync(join(tmpdir(), "tracked-services-nogit-"));
});

afterAll(() => {
  for (const d of [repo, emptyRepo, notARepo]) {
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("tracked-services: git decides what a service is", () => {
  test("a tracked service is in the set", () => {
    expect(trackedServiceNames(repo).has("svc-real")).toBe(true);
  });

  test("an untracked leftover is NOT — even with a package.json next to it", () => {
    expect(
      trackedServiceNames(repo).has("svc-phantom"),
      "a directory that git does not track is residue, not a service; this is the exact " +
        "shape that made the OWASP adoption gate fail locally and block every push",
    ).toBe(false);
  });

  test("the set contains nothing but the tracked services", () => {
    expect([...trackedServiceNames(repo)].sort()).toEqual(["svc-real"]);
  });

  test("isTrackedService agrees with the set", () => {
    expect(isTrackedService("svc-real", repo)).toBe(true);
    expect(isTrackedService("svc-phantom", repo)).toBe(false);
  });
});

describe("tracked-services: fails loud rather than degrading", () => {
  test("a repo tracking no services THROWS instead of returning an empty set", () => {
    // An empty set would make `describe.each(services)` iterate nothing, so every
    // service gate would pass vacuously — indistinguishable from success, and the worst
    // possible outcome for a security gate.
    expect(() => trackedServiceNames(emptyRepo)).toThrow(/tracks no paths under services/);
  });

  test("outside a git repo it THROWS instead of falling back to a filesystem scan", () => {
    // Falling back to readdirSync is precisely the behaviour this helper replaces.
    expect(() => trackedServiceNames(notARepo)).toThrow(/git ls-files' failed/);
  });
});
