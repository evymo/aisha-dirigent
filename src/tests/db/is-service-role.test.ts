/**
 * is_service_role() — NULL-safe service-role detection (fail-closed contract).
 *
 * The bug this locks out: the inline
 *   (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
 * folds to SQL NULL when the `role` claim is absent, and NULL propagates through
 * negative deny-guards (`IF ... AND NOT v_is_service` → `IF NULL` never RAISEs)
 * so the guard FAILS OPEN. is_service_role() must return a concrete boolean in
 * every claims state — never NULL — so any `NOT is_service_role()` guard is total.
 */
import { describe, it, expect } from "vitest";
import { psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";
import { beforeAll } from "vitest";

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("is_service_role null-safety");
});

/**
 * Evaluate is_service_role() after setting request.jwt.claims to `claims`.
 * set_config runs in the WHERE clause so the statement emits ONLY the boolean
 * (a leading `SELECT set_config(...)` statement would print its own value too).
 */
function isServiceUnder(claims: string): string {
  return psqlQuery(
    `SELECT public.is_service_role()::text ` +
      `WHERE set_config('request.jwt.claims', ${claims}, false) IS NOT NULL`,
  ).trim();
}

describe("is_service_role() — never NULL, fails closed", () => {
  it.skipIf(!dbAvailable)("returns concrete boolean for every claims state (never NULL)", () => {
    // claims present but NO role key → the inline idiom folds to NULL here (the
    // exact fail-open trigger); the helper must return a concrete false.
    expect(isServiceUnder(`'{}'`)).toBe("false");
    // claims GUC entirely unset (fresh connection, nothing set) → the real
    // "no token" path: current_setting(...,true)=NULL, ::jsonb=NULL, no throw.
    expect(psqlQuery(`SELECT public.is_service_role()::text`).trim()).toBe("false");
    // authenticated / anon are not service
    expect(isServiceUnder(`'{"role":"authenticated"}'`)).toBe("false");
    expect(isServiceUnder(`'{"role":"anon"}'`)).toBe("false");
    // the real thing
    expect(isServiceUnder(`'{"role":"service_role"}'`)).toBe("true");
  });

  // Note: the second `current_setting('role')='service_role'` disjunct is kept
  // for parity with the two already-hardened siblings, but it is NOT asserted
  // here — read through a SECURITY DEFINER helper the `role` GUC reflects the
  // definer context, not a caller's in-DB SET ROLE, so its semantics are subtle
  // and it is not the load-bearing path. PostgREST callers are authoritative via
  // the JWT-claim path, exercised exhaustively above.

  it.skipIf(!dbAvailable)("is granted to anon/authenticated/service_role (adoptable everywhere)", () => {
    const grantees = psqlQuery(
      `SELECT string_agg(grantee, ',' ORDER BY grantee) ` +
        `FROM information_schema.routine_privileges ` +
        `WHERE routine_name = 'is_service_role' AND privilege_type = 'EXECUTE'`,
    ).trim();
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(grantees, `must GRANT EXECUTE to ${role}`).toContain(role);
    }
  });
});
