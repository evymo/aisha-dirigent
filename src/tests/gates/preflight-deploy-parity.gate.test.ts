/**
 * Gate: preflight ↔ count-check ↔ deploy agree on conditional-stack gating
 *
 * Gaps #1 + #2 of the 2026-06-29 prod cold-start --wipe incident: the federation
 * stack (source-broker) is created by coolify-story-init.sh ONLY when
 * SOURCE_API_URL is set, but:
 *   #1 preflight-compose.sh validated it UNCONDITIONALLY → `docker compose
 *      config` failed on the absent operator handshake secrets;
 *   #2 aisha-cold-start.sh's count-check expected it in the manifest count →
 *      "found N < N+1" false-abort BEFORE any deploy.
 * Three sites computed the deployed-set by SEPARATE logic and diverged.
 *
 * This gate keeps them in lock-step: the federation skip condition
 * (SOURCE_API_URL → source-broker) must be present in ALL THREE sites, so a
 * future change to one without the others is caught here rather than on a prod
 * --wipe. DYNAMIC: matches the env+stack tokens in the scripts, no allow-list.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("preflight ↔ count-check ↔ deploy conditional-stack parity", () => {
  // The deploy SoT (coolify-story-init.sh) creates source-broker iff
  // SOURCE_API_URL is set; preflight + count-check must mirror that gate.
  const SITES: Record<string, string> = {
    "deploy (coolify-story-init.sh)": "scripts/coolify-story-init.sh",
    "preflight (preflight-compose.sh)": "scripts/preflight-compose.sh",
    "count-check (aisha-cold-start.sh)": "scripts/aisha-cold-start.sh",
  };

  test("every site gates the federation stack (source-broker) on SOURCE_API_URL", () => {
    const missing: string[] = [];
    for (const [label, path] of Object.entries(SITES)) {
      const c = read(path);
      const refsEnv = /SOURCE_API_URL/.test(c);
      const refsStack = /source-broker/.test(c);
      if (!(refsEnv && refsStack)) {
        missing.push(
          `${label}: ${refsEnv ? "" : "no SOURCE_API_URL gate; "}` +
            `${refsStack ? "" : "no source-broker reference"}`,
        );
      }
    }
    expect(
      missing,
      "The conditional federation stack must be gated identically " +
        "(SOURCE_API_URL → source-broker) in preflight, count-check, AND deploy. " +
        "Divergence re-introduces the 2026-06-29 false-abort (preflight/count " +
        "validating a stack the deploy skips):\n" + missing.join("\n"),
    ).toEqual([]);
  });
});
