/**
 * @file e2e-dirigent-fixture-drift.gate.test.ts
 *
 * Ensures `tests/e2e-dirigent/workspace-fixture/.claude/` stays in sync
 * with the repo's authoritative `.claude/` overlay. Without this gate the
 * e2e suite would silently test yesterday's overlay after a rule change —
 * green CI, broken protection.
 *
 * Files checked (byte-exact):
 *   - .claude/hooks/aisha-*.sh + aisha-supervisor-relay.mjs + _aisha-advise-lib.sh
 *   - .claude/agents/aisha-advisor.md
 *   - .claude/skills/aisha-supervisor/SKILL.md
 *   - .claude/commands/aisha-*.md
 *   - .claude/statusline.sh
 *   - .claude/settings.json
 *
 * Fix path when this fails: copy the changed files into the fixture
 * (see `tests/e2e-dirigent/README.md § 7`).
 *
 * NOT checked: settings.local.json (per-developer; never in fixture)
 * and the hooks list under .claude/lib/ (not part of overlay surface).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "node:child_process";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_ROOT = path.join(REPO_ROOT, "tests/e2e-dirigent/workspace-fixture/.claude");
const SOURCE_ROOT = path.join(REPO_ROOT, ".claude");

/**
 * Enumerate generator-managed `.claude/` files via `git ls-files`.
 *
 * Why git ls-files and not `readdirSync` recursion: `.claude/worktrees/*`
 * and `.claude/settings.local.json` are gitignored (per .gitignore
 * `.claude/*` + allowlist pattern). A recursive filesystem walk would
 * descend into per-session Claude Code worktree sandboxes — which contain
 * their own copies of `.claude/` — and emit 800+ false positives on
 * developer machines with active sessions. Tracked files are the precise
 * universe this gate should cover; everything else is local-only ephemera.
 */
function listAishaFiles(): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["ls-files", ".claude/"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((p) => p.replace(/^\.claude\//, ""))
    .filter((rel) => {
      const base = path.basename(rel);
      const dir = path.dirname(rel);
      return (
        base.startsWith("aisha-") ||
        base === "_aisha-advise-lib.sh" ||
        base === "statusline.sh" ||
        base === "settings.json" ||
        (dir === "skills/aisha-supervisor" && base === "SKILL.md")
      );
    });
}

describe("E2E Dirigent fixture drift", () => {
  const aishaFiles = listAishaFiles();

  it("has at least the expected core hooks + agent + skill + settings", () => {
    // Sanity: gate would silently pass if no files were enumerated
    expect(aishaFiles.length).toBeGreaterThanOrEqual(10);
    expect(aishaFiles).toContain("hooks/_aisha-advise-lib.sh");
    expect(aishaFiles).toContain("hooks/aisha-supervisor-relay.mjs");
    expect(aishaFiles).toContain("agents/aisha-advisor.md");
    expect(aishaFiles).toContain("skills/aisha-supervisor/SKILL.md");
    expect(aishaFiles).toContain("statusline.sh");
    expect(aishaFiles).toContain("settings.json");
  });

  it.each(aishaFiles)("fixture matches source: %s", (relPath) => {
    const sourcePath = path.join(SOURCE_ROOT, relPath);
    const fixturePath = path.join(FIXTURE_ROOT, relPath);

    expect(existsSync(fixturePath), `fixture missing ${relPath} — copy from .claude/${relPath} into tests/e2e-dirigent/workspace-fixture/.claude/`).toBe(true);

    const src = readFileSync(sourcePath, "utf-8");
    const fix = readFileSync(fixturePath, "utf-8");
    expect(fix, `drift in ${relPath} — fixture is stale, copy from .claude/${relPath}`).toBe(src);
  });
});
