/**
 * GATE: the Zed extension's bundled MCP bridge stays in sync with its Source of Truth.
 *
 * WHY
 * ---
 * `extensions/aisha-dirigent-zed/server/aisha-mcp-stdio-bridge.mjs` is a GENERATED
 * esbuild bundle of the monorepo bridge (`server/aisha-mcp-stdio-bridge.mjs` +
 * `packages/dirigent-core`). It is committed because a Zed extension is built
 * OUTSIDE the monorepo and Zed never runs npm — so the bridge must physically
 * ship inside the extension.
 *
 * The AISHA Branding Gate deliberately SKIPS this file as a generated artefact
 * (its single `supabase` token is inlined 1:1 from the baselined SoT
 * `packages/dirigent-core`). That skip is only sound while the committed bundle
 * genuinely equals a fresh build of the SoT — otherwise a hand-edited bundle
 * could smuggle in un-scanned content, or a stale bundle could ship an outdated
 * bridge. This gate closes that loop by re-running the deterministic generator
 * in `--check` mode (the exact same code path as `npm run gen:bridge`).
 *
 * On failure (SoT changed but the bundle was not regenerated, or the bundle was
 * hand-edited):
 *   npm --prefix extensions/aisha-dirigent-zed run gen:bridge
 * then commit the refreshed bundle.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const CHECK_SCRIPT = path.join(
  REPO_ROOT,
  "extensions/aisha-dirigent-zed/scripts/bundle-bridge.mjs",
);

describe("GATE: Zed MCP bridge bundle is fresh vs its Source of Truth", () => {
  it("the generator script exists (guards against a silently-skipped check)", () => {
    expect(existsSync(CHECK_SCRIPT), `missing ${CHECK_SCRIPT}`).toBe(true);
  });

  it("the committed bundle equals a fresh esbuild of the monorepo SoT", () => {
    let ok = true;
    let output = "";
    try {
      // Same node that runs the gate; the script resolves the repo-pinned
      // esbuild from node_modules, so the comparison is deterministic in CI.
      output = execFileSync(process.execPath, [CHECK_SCRIPT, "--check"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      ok = false;
      const e = err as { stdout?: string; stderr?: string; message?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.trim();
    }
    expect(
      ok,
      `Zed MCP bridge bundle is stale or unbuildable:\n${output}\n\n` +
        `Regenerate + commit: npm --prefix extensions/aisha-dirigent-zed run gen:bridge`,
    ).toBe(true);
  });
});
