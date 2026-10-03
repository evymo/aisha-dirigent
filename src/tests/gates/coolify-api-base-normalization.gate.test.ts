/**
 * COOLIFY_API base-URL normalization gate.
 *
 * Footgun (incident 2026-07-05, netbird redeploy): a non-empty COOLIFY_API that
 * lacks /api/v1 — e.g. `export COOLIFY_API=$COOLIFY_URL`, where the token file
 * ships COOLIFY_URL as the bare host — was used VERBATIM, so `$COOLIFY_API/applications`
 * hit `<host>/applications` → 404/HTML → the caller found zero apps and aborted
 * ("Žádná aplikace nevyhovuje filtru"). The old per-script derive-only-when-empty
 * guard fixed only the UNSET half, never the set-but-bare half.
 *
 * This gate makes the fix STRUCTURAL: every script that builds a path off
 * $COOLIFY_API MUST normalize it to <host>/api/v1 — either by sourcing the shared
 * scripts/lib/coolify-api-base.sh + resolve_coolify_api, or with an equivalent
 * idempotent inline normalization. A new consumer that skips it fails here.
 */

import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, "scripts");
const LIB = join(SCRIPTS, "lib");

/** Every .sh under scripts/ and scripts/lib/. */
function shellScripts(): { name: string; path: string; body: string }[] {
  const out: { name: string; path: string; body: string }[] = [];
  for (const dir of [SCRIPTS, LIB]) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".sh")) continue;
      const path = join(dir, f);
      out.push({ name: f, path, body: readFileSync(path, "utf8") });
    }
  }
  return out;
}

/** A script that builds a path directly off $COOLIFY_API (the risky pattern). */
function buildsCoolifyApiPath(body: string): boolean {
  return /\$\{?COOLIFY_API\}?\/(applications|deploy|services|databases|envs|projects)/.test(body);
}

/** Normalizes COOLIFY_API to <host>/api/v1 (shared helper OR idempotent inline). */
function normalizesCoolifyApi(body: string): boolean {
  const usesHelper =
    /coolify-api-base\.sh/.test(body) && /resolve_coolify_api/.test(body);
  // Idempotent inline: references COOLIFY_URL AND appends /api/v1 only-if-missing.
  const idempotentInline =
    /COOLIFY_URL/.test(body) &&
    (/\*\/api\/v1\)/.test(body) || /%\/\}\/api\/v1/.test(body) || /endsWith\([^)]*api\/v1/.test(body));
  return usesHelper || idempotentInline;
}

describe("COOLIFY_API base-URL normalization", () => {
  const scripts = shellScripts();

  test("the shared helper exists and is idempotent-by-construction", () => {
    const helper = scripts.find((s) => s.name === "coolify-api-base.sh");
    expect(helper, "scripts/lib/coolify-api-base.sh must exist").toBeDefined();
    expect(helper!.body, "helper must define resolve_coolify_api").toMatch(/resolve_coolify_api\s*\(\)/);
    // Idempotent: only appends /api/v1 when missing (the */api/v1) case).
    expect(helper!.body, "helper must be idempotent (*/api/v1) case)").toMatch(/\*\/api\/v1\)/);
    // Precedence COOLIFY_API → COOLIFY_URL → COOLIFY_BASE_URL.
    expect(helper!.body).toMatch(/COOLIFY_API:-\$\{COOLIFY_URL:-\$\{COOLIFY_BASE_URL/);
  });

  test("every script that builds $COOLIFY_API/<path> normalizes the base URL", () => {
    const consumers = scripts.filter((s) => s.name !== "coolify-api-base.sh" && buildsCoolifyApiPath(s.body));
    const offenders = consumers
      .filter((s) => !normalizesCoolifyApi(s.body))
      .map((s) => s.name);
    // sanity: we must actually be scanning consumers, not zero (guard-the-guard).
    expect(consumers.length, "expected to find COOLIFY_API path consumers").toBeGreaterThan(1);
    expect(
      offenders,
      `these scripts build $COOLIFY_API/<path> but do NOT normalize to <host>/api/v1 ` +
        `(source scripts/lib/coolify-api-base.sh + resolve_coolify_api):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("the known worst-offender consumers are actually detected + covered", () => {
    // Guard-the-guard: if the detector regex silently stops matching these, the
    // offenders check above becomes vacuous. Pin the known consumers.
    const byName = new Map(scripts.map((s) => [s.name, s]));
    for (const name of ["coolify-sync-envs.sh", "pki-issue-internal-cert.sh", "aisha-deploy-all.sh"]) {
      const s = byName.get(name);
      expect(s, `${name} must exist`).toBeDefined();
      expect(buildsCoolifyApiPath(s!.body) || normalizesCoolifyApi(s!.body), `${name} must be a tracked COOLIFY_API consumer`).toBe(true);
      expect(normalizesCoolifyApi(s!.body), `${name} must normalize COOLIFY_API`).toBe(true);
    }
  });
});
