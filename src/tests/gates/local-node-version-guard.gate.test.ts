/**
 * Local warmup — Node >=22 enforcement + VITE build-time caveat
 *
 * The generator and its libs use modern ESM/syntax; a stale `node` on PATH (e.g.
 * an old nvm default) fails with cryptic SyntaxErrors instead of a clear message.
 * scripts/local-warmup.sh now checks the Node MAJOR version (not just presence),
 * and scripts/local-compose-gen.mjs carries a defensive guard for direct
 * invocation. The warmup also surfaces that VITE_* are build-time (a preset change
 * needs a web-image rebuild). String-level gate (no exec).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

describe("Local warmup — Node >=22 enforcement", () => {
  const sh = read("scripts/local-warmup.sh");
  const gen = read("scripts/local-compose-gen.mjs");

  test("local-warmup.sh enforces Node MAJOR >= 22 (version, not just `command -v node`)", () => {
    expect(sh, "must read the node version").toMatch(/NODE_MAJOR=.*node -v/);
    expect(sh, "must fail when major < 22").toMatch(/NODE_MAJOR"? -lt 22/);
    expect(sh, "must guide the dev to the repo Node").toMatch(/nvm use 22/);
  });

  test("local-compose-gen.mjs has a defensive Node >=22 guard (direct invocation)", () => {
    expect(gen, "reads the running Node version").toMatch(/process\.versions\.node/);
    expect(gen, "exits non-zero on Node < 22").toMatch(/NODE_MAJOR\s*<\s*22[\s\S]*process\.exit\(1\)/);
  });

  test("warmup surfaces the VITE build-time caveat (rebuild after preset change)", () => {
    expect(sh, "VITE_* are baked at build time").toMatch(/VITE_\*[\s\S]*build-time/i);
    expect(sh, "tells the dev to rebuild the web image").toMatch(/--build/);
  });
});
