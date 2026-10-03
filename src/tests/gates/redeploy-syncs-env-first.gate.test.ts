/**
 * Gate: aisha-redeploy.mjs must RE-SYNC an app's env (coolify-sync-envs.sh)
 * BEFORE it force-redeploys that app — never deploy against a stale on-app env.
 *
 * Incident 2026-06-13 (realtime): docker-compose.coolify-realtime.yml was edited
 * to add `redis://core:${REDIS_PASSWORD_CORE}@aisha-shared-redis:6379`, but a
 * standalone `npm run redeploy` triggers only `POST /deploy?...&force=true` — it
 * never runs coolify-sync-envs.sh (only cold-start does, by ordering accident).
 * force=true recreated the container and interpolated the NEW ${REDIS_PASSWORD_CORE}
 * against the app's CURRENT Coolify env, which lacked the var → it resolved to an
 * EMPTY password → Redis WRONGPASS crashloop. The fix re-syncs the app's env
 * (per-app intersection of compose ${VAR}s ∩ .env.coolify) inside triggerDeploy,
 * before the deploy POST.
 *
 * This gate locks the ORDERING inside triggerDeploy: the sync shell-out must
 * precede the force=true deploy POST. Existing env gates only prove a SOURCE for
 * a var exists (generate-secrets / .env.coolify); none prove the running app
 * actually RECEIVES the value at redeploy time — that is the gap this closes.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf-8") : "");

const src = read("scripts/aisha-redeploy.mjs");

// Isolate the triggerDeploy function body so the ordering assertion is scoped to
// the deploy trigger (not coincidental ordering elsewhere in the file). Bound the
// slice at the next top-level function/section so we don't bleed into neighbours.
function triggerDeployBody(source: string): string {
  const start = source.indexOf("async function triggerDeploy");
  if (start < 0) return "";
  const after = source.slice(start + "async function triggerDeploy".length);
  const next = after.search(/\n(?:async function |function |\/\/ ──)/);
  return next >= 0 ? after.slice(0, next) : after;
}

describe("Redeploy re-syncs env before deploying", () => {
  test("aisha-redeploy.mjs exists and defines triggerDeploy", () => {
    expect(src.length, "scripts/aisha-redeploy.mjs not found").toBeGreaterThan(0);
    expect(src).toContain("async function triggerDeploy");
  });

  test("triggerDeploy invokes coolify-sync-envs.sh", () => {
    const body = triggerDeployBody(src);
    expect(
      body,
      "triggerDeploy must re-sync the app env via coolify-sync-envs.sh before redeploying (else a new compose ${VAR} interpolates empty → WRONGPASS, incident 2026-06-13)",
    ).toContain("coolify-sync-envs.sh");
  });

  test("the env-sync runs BEFORE the force=true deploy POST", () => {
    const body = triggerDeployBody(src);
    const syncIdx = body.indexOf("coolify-sync-envs.sh");
    const deployIdx = body.search(/\/deploy\?uuid=\$\{uuid\}&force=true/);
    expect(deployIdx, "force=true deploy POST not found in triggerDeploy").toBeGreaterThanOrEqual(0);
    expect(syncIdx, "coolify-sync-envs.sh not found in triggerDeploy").toBeGreaterThanOrEqual(0);
    expect(
      syncIdx < deployIdx,
      `env-sync (idx ${syncIdx}) must precede the force=true deploy POST (idx ${deployIdx}) — otherwise the deploy uses stale env`,
    ).toBe(true);
  });

  test("a sync failure fails the trigger (no deploy with stale env)", () => {
    const body = triggerDeployBody(src);
    // The sync's catch must short-circuit (return { ok: false, ... }) rather than
    // swallow-and-continue to the deploy — fail closed, never deploy stale env.
    expect(
      /catch[\s\S]*?return\s*\{\s*ok:\s*false[\s\S]*?\}/.test(body),
      "a failed env-sync must return { ok: false } (fail closed), not fall through to the deploy",
    ).toBe(true);
  });
});
