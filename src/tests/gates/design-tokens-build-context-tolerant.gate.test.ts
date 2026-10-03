/**
 * Design-tokens build — context-tolerance gate.
 *
 * Regression pin for a works-in-CI / breaks-in-container bug (prod 2026-07-19):
 *
 *   `packages/design-tokens/build.mjs` also generates the MOBILE theme, writing
 *   it to `mobile-app/src/theme/index.ts` (metro cannot import from dist/, so the
 *   theme has to LIVE in the mobile tree). CI runs the script against the full
 *   monorepo — mobile-app present — so it passed. But the WEB/service Docker image
 *   excludes `mobile-app/` via `.dockerignore`, so inside that build the write
 *   target is absent and the unconditional `writeFileSync` threw
 *   `ENOENT … /app/mobile-app/src/theme/index.ts`, failing the WHOLE token build
 *   (the very first Dockerfile RUN). Coolify then kept serving the stale, unhealthy
 *   aisha-core container → api/ask 502. CI could never see it because CI always has
 *   the full tree.
 *
 * The invariant: the token build must TOLERATE a context where its mobile write
 * target is absent (the web/service Docker context) — generate the mobile theme
 * where the target tree exists, skip (never throw) where it does not. This gate
 * exercises exactly that context, so a future edit that makes the mobile write
 * unconditional again fails HERE (in CI's full tree) instead of only in prod.
 */
import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const BUILD = resolve(ROOT, "packages/design-tokens/build.mjs");

describe("design-tokens build tolerates a mobile-app-excluded context", () => {
  test("build.mjs exists", () => {
    expect(existsSync(BUILD)).toBe(true);
  });

  test("default build skips (does not throw) when the mobile write target is absent", () => {
    // Simulate the web/service Docker context: point the mobile output at a dir
    // that does not exist (mirrors `.dockerignore` stripping mobile-app/). The
    // build must exit 0 and skip the mobile theme — NOT ENOENT.
    const absent = join(tmpdir(), "aisha-design-tokens-gate-absent", "src", "theme", "index.ts");
    rmSync(join(tmpdir(), "aisha-design-tokens-gate-absent"), { recursive: true, force: true });

    const r = spawnSync(process.execPath, [BUILD, "--out", absent], {
      cwd: ROOT,
      encoding: "utf-8",
    });

    expect(
      r.status,
      `build.mjs must tolerate a mobile-app-excluded build context (exit 0), got ${r.status}.\n` +
        `stdout: ${r.stdout}\nstderr: ${r.stderr}\n` +
        `If this fails with ENOENT, the mobile-theme write is unconditional again — ` +
        `guard it with existsSync(dirname(MOBILE_OUT)) in the default dispatch.`,
    ).toBe(0);
    expect(r.stdout).toMatch(/mobile theme skipped/i);
    // And it must not have created an orphan mobile tree in that absent context.
    expect(existsSync(absent)).toBe(false);
  });

  test("source guards the mobile write in the default dispatch (intent is explicit)", () => {
    // Structural belt-and-suspenders: the functional test above proves behavior,
    // this pins the mechanism so an accidental un-guard is obvious in review.
    const src = readFileSync(BUILD, "utf-8");
    expect(
      /existsSync\(\s*dirname\(\s*MOBILE_OUT\s*\)\s*\)/.test(src),
      "the default dispatch must gate buildMobileTheme on the presence of its output dir",
    ).toBe(true);
  });
});
