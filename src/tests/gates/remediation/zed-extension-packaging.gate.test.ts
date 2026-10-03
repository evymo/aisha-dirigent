/**
 * GATE: every Zed extension must be reproducibly packageable.
 *
 * CONTRACT
 * --------
 * A Zed extension (a directory holding both `extension.toml` and a Rust
 * `Cargo.toml`) is shipped as a standalone artifact — Zed clones/downloads it
 * OUTSIDE the monorepo and compiles it in isolation. For that to be
 * reproducible three things must hold for EACH such extension:
 *
 *   (a) Cargo.lock is git-TRACKED (so the dependency graph is pinned and the
 *       build is reproducible) and is NOT excluded by that directory's
 *       .gitignore. Truth source = `git ls-files` (index membership), which is
 *       exactly what a fresh clone / `git archive` would receive.
 *
 *   (b) The MCP stdio bridge that `src/lib.rs` launches at runtime
 *       (`server/aisha-mcp-stdio-bridge.mjs`, relative to the extension root)
 *       is actually present inside the extension — either committed as a
 *       bundled copy, or produced by a declared build step (build.rs /
 *       package.json script / Cargo metadata that references the bridge). The
 *       monorepo-relative fallback (`../../server/...`) only resolves in a dev
 *       checkout, so a packaged extension that relies on it is broken.
 *
 *   (c) At least one Rust unit test exists in `src/` (`#[test]` or
 *       `#[cfg(test)]`) so the extension carries an executable smoke test.
 *
 * KNOWN-RED (branch feat/remediation, HEAD-era) for
 * `extensions/aisha-dirigent-zed`:
 *   (a) `.gitignore` contains `/Cargo.lock` ⇒ Cargo.lock is UNTRACKED.
 *   (b) no `server/aisha-mcp-stdio-bridge.mjs` inside the extension and no
 *       build step produces it — only the dev-only `../../server` copy exists.
 *   (c) `src/lib.rs` has zero `#[test]` / `#[cfg(test)]`.
 *
 * POST-FIX (GREEN): commit Cargo.lock (drop the /Cargo.lock ignore), bundle (or
 * build) the bridge into the extension, and add a smoke test.
 *
 * PATTERN gate: it DISCOVERS every Zed extension in the tree (extension.toml +
 * Cargo.toml) and asserts the contract for each, so a future sibling extension
 * with the same packaging defect is caught automatically. Allowlist below is
 * intentionally empty.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

/** Extension dirs (repo-relative) exempt from this contract. Keep empty. */
const ALLOWLIST = new Set<string>([]);

/** `git ls-files -- <pathspec>` → tracked paths (index membership). */
function gitTracked(pathspec: string): string[] {
  const out = execFileSync("git", ["ls-files", "--", pathspec], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

/** Discover every Zed extension: a dir with BOTH extension.toml and Cargo.toml. */
function discoverZedExtensions(): string[] {
  // Use tracked extension.toml files so we don't wander into worktrees/target.
  const tomls = gitTracked("**/extension.toml");
  const dirs = new Set<string>();
  for (const rel of tomls) {
    const dir = path.dirname(rel);
    if (fs.existsSync(path.join(REPO_ROOT, dir, "Cargo.toml"))) dirs.add(dir);
  }
  return [...dirs].filter((d) => !ALLOWLIST.has(d)).sort();
}

function readIfExists(abs: string): string | null {
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

const EXTENSIONS = discoverZedExtensions();

describe("GATE: Zed extensions must be reproducibly packageable", () => {
  it("discovers at least one Zed extension to guard", () => {
    expect(EXTENSIONS.length, "no extension.toml+Cargo.toml extension found").toBeGreaterThan(0);
  });

  it("(a) Cargo.lock is git-tracked and not .gitignored, for every extension", () => {
    const offenders: string[] = [];
    for (const dir of EXTENSIONS) {
      const lockRel = path.posix.join(dir, "Cargo.lock");
      const tracked = gitTracked(lockRel).includes(lockRel);
      if (!tracked) {
        offenders.push(`${dir}: Cargo.lock is NOT tracked by git (git ls-files empty)`);
        continue;
      }
      // Belt-and-braces: a tracked file can still be .gitignore'd for future adds.
      const gi = readIfExists(path.join(REPO_ROOT, dir, ".gitignore"));
      if (gi && /^\s*\/?Cargo\.lock\s*$/m.test(gi)) {
        offenders.push(`${dir}: .gitignore excludes Cargo.lock`);
      }
    }
    expect(offenders, `Cargo.lock not reproducibly pinned:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("(b) the MCP bridge lib.rs launches is bundled in / built by the extension", () => {
    const offenders: string[] = [];
    for (const dir of EXTENSIONS) {
      const extAbs = path.join(REPO_ROOT, dir);
      const lib = readIfExists(path.join(extAbs, "src", "lib.rs"));
      if (lib === null || !/aisha-mcp-stdio-bridge\.mjs/.test(lib)) continue; // not this class

      // The bundled path lib.rs uses, resolved relative to the extension root.
      const bundledRel =
        lib.match(/const\s+BUNDLED_BRIDGE_PATH[^"]*"([^"]+)"/)?.[1] ??
        "server/aisha-mcp-stdio-bridge.mjs";
      const bundledPresent = fs.existsSync(path.join(extAbs, bundledRel));

      // Accept a declared build step that references the bridge filename.
      const buildInputs = [
        readIfExists(path.join(extAbs, "build.rs")),
        readIfExists(path.join(extAbs, "package.json")),
        readIfExists(path.join(extAbs, "extension.toml")),
        readIfExists(path.join(extAbs, "Cargo.toml")),
      ]
        .filter((s): s is string => s !== null)
        .join("\n");
      const buildProduces = /aisha-mcp-stdio-bridge\.mjs/.test(buildInputs);

      if (!bundledPresent && !buildProduces) {
        offenders.push(
          `${dir}: bridge "${bundledRel}" is neither bundled (missing at ${dir}/${bundledRel}) ` +
            `nor produced by a declared build step (build.rs/package.json/extension.toml/Cargo.toml)`,
        );
      }
    }
    expect(offenders, `MCP bridge not shippable with the extension:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("(c) at least one Rust unit test exists in src/, for every extension", () => {
    const offenders: string[] = [];
    for (const dir of EXTENSIONS) {
      const srcAbs = path.join(REPO_ROOT, dir, "src");
      if (!fs.existsSync(srcAbs)) {
        offenders.push(`${dir}: no src/ directory`);
        continue;
      }
      const rustFiles: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".rs")) rustFiles.push(p);
        }
      };
      walk(srcAbs);
      const hasTest = rustFiles.some((f) => /#\[\s*(test|cfg\s*\(\s*test\s*\))/.test(fs.readFileSync(f, "utf8")));
      if (!hasTest) offenders.push(`${dir}: no #[test]/#[cfg(test)] found in src/*.rs`);
    }
    expect(offenders, `Extension carries no smoke test:\n${offenders.join("\n")}`).toEqual([]);
  });
});
