/**
 * JIT pre-request wiring gate
 *
 * Guards the central fix for FK 23503 → HTTP 409 on writes to tables whose
 * user_id FKs aisha_auth.users (consents, chat_*, health_*, notification_*, …):
 * a freshly-authenticated Keycloak user has a valid JWT but no aisha_auth.users
 * row until provisioned. public.ensure_current_user is the documented
 * "first-request hook"; this gate asserts it is actually WIRED as PostgREST's
 * global db-pre-request, in all three places that must agree, so the hook can
 * never silently drop:
 *   1. the SoT function exists, is SECURITY DEFINER, calls ensure_current_user,
 *      is read-only-tx safe + exception-safe, and is EXECUTE-able by every
 *      request role (anon / authenticated / service_role);
 *   2. it is baked into the generated baseline (i.e. it actually deploys);
 *   3. PostgREST is pointed at it via IN-DATABASE config — `ALTER ROLE
 *      authenticator SET pgrst.db_pre_request` — NOT the compose env: the core
 *      compose is at the Coolify ARG_MAX ceiling and must not grow.
 *
 * Run: npx vitest run -c vitest.gates.config.ts src/tests/gates/jit-pre-request.gate.test.ts
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN = join(ROOT, "aisha/db/sql/functions/aisha_pre_request.sql");
const BASELINE = join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");
const ROLE_CFG = join(ROOT, "aisha/db/sql/grants/authenticator_pgrst_pre_request.sql");

describe("JIT pre-request hook wiring", () => {
  test("SoT function aisha_pre_request is present and correctly shaped", () => {
    expect(
      existsSync(FN),
      [
        "aisha/db/sql/functions/aisha_pre_request.sql is missing.",
        "WHY: it is the PostgREST db-pre-request hook that JIT-provisions the",
        "authenticated caller (via ensure_current_user) so FK-to-aisha_auth.users",
        "writes never 409. HOW TO FIX: restore the function file from git history.",
      ].join("\n"),
    ).toBe(true);

    const src = readFileSync(FN, "utf8");
    const checks: Array<[string, boolean]> = [
      ["SECURITY DEFINER", /SECURITY\s+DEFINER/i.test(src)],
      ["calls ensure_current_user", /ensure_current_user\s*\(/.test(src)],
      ["read-only-tx guard", /transaction_read_only/.test(src)],
      ["exception-safe (never blocks a request)", /EXCEPTION\s+WHEN\s+OTHERS/i.test(src)],
      ["granted to anon", /GRANT\s+EXECUTE[\s\S]*?TO\s+anon/i.test(src)],
      ["granted to authenticated", /GRANT\s+EXECUTE[\s\S]*?TO\s+authenticated/i.test(src)],
      ["granted to service_role", /GRANT\s+EXECUTE[\s\S]*?TO\s+service_role/i.test(src)],
    ];
    const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
    expect(
      missing,
      [
        `aisha_pre_request.sql is missing required properties: ${missing.join(", ")}.`,
        "WHY: db-pre-request runs as the request role before every request; it must",
        "be SECURITY DEFINER (to provision regardless of caller grants), EXECUTE-able",
        "by anon/authenticated/service_role, skip read-only txns, and never raise.",
        "HOW TO FIX: edit aisha/db/sql/functions/aisha_pre_request.sql to restore the",
        "missing piece, then regenerate the baseline: `npm run db:init:generate`.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("the hook is baked into the generated baseline (deploys on cold-start)", () => {
    const baseline = readFileSync(BASELINE, "utf8");
    expect(
      /FUNCTION\s+public\.aisha_pre_request\s*\(/i.test(baseline),
      [
        "00000000000000_baseline.sql does not contain public.aisha_pre_request —",
        "the SoT function exists but was never regenerated into the baseline, so a",
        "fresh/cold-start DB would lack the hook and 409s would return.",
        "HOW TO FIX: `npm run db:init:generate` (regenerates the baseline from",
        "aisha/db/sql/), then commit the updated baseline.",
      ].join("\n"),
    ).toBe(true);
  });

  test("PostgREST is wired to call the hook via in-database config (not compose env)", () => {
    expect(
      existsSync(ROLE_CFG),
      [
        "aisha/db/sql/grants/authenticator_pgrst_pre_request.sql is missing.",
        "WHY: the hook is wired via a role-level GUC (PostgREST db-config), NOT the",
        "compose env PGRST_DB_PRE_REQUEST — the core compose is at the Coolify",
        "ARG_MAX ceiling and must not grow. HOW TO FIX: restore the grants file.",
      ].join("\n"),
    ).toBe(true);

    const cfg = readFileSync(ROLE_CFG, "utf8");
    expect(
      /ALTER\s+ROLE\s+authenticator\s+SET\s+pgrst\.db_pre_request\s*=\s*'public\.aisha_pre_request'/i.test(cfg),
      [
        "authenticator_pgrst_pre_request.sql does not set",
        "  ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.aisha_pre_request';",
        "Without it PostgREST never calls the hook, so authenticated callers stay",
        "unprovisioned and FK-to-aisha_auth.users writes 409.",
        "HOW TO FIX: restore that statement (PostgREST reads pgrst.* from the",
        "authenticator role with db-config on; the compose stays untouched).",
      ].join("\n"),
    ).toBe(true);

    const baseline = readFileSync(BASELINE, "utf8");
    expect(
      /pgrst\.db_pre_request/.test(baseline),
      [
        "the in-database pre-request setting is not in the generated baseline —",
        "the grants file exists but wasn't regenerated in, so a cold-start DB would",
        "not have PostgREST wired to the hook.",
        "HOW TO FIX: `npm run db:init:generate`, then commit the updated baseline.",
      ].join("\n"),
    ).toBe(true);
  });
});
