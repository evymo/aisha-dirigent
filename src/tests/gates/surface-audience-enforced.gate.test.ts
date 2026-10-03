import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A section a user has no claim to must not even be NAMED to him.
 *
 * `surface_layouts.audience` shipped with the comment "the column holds the
 * declaration, evaluation lands in RLS/RPC later" — and nobody ever read it.
 * Measured live 2026-07-28: the single authenticated-facing policy had
 * `USING (is_active = true)`, so `list_surface_sections()` handed EVERY signed-in
 * user all six sections, `admin` included. Block DATA is trimmed by RLS inside
 * each data RPC, so nothing leaked from inside a block — but the NAMES of the
 * sections leaked, and a surface whose whole job is to show one person only his
 * own work must not disclose what else exists.
 *
 * This gate pins the PROPERTIES that make the declaration real, not the spelling
 * of any one section or role:
 *   1. the authenticated-facing policy actually evaluates the declaration;
 *   2. the predicate denies declarations it does not understand (a typo like
 *      `role` for `roles` must fail closed, never silently open a section);
 *   3. the predicate never calls the 1-arg tier function, which returns SQL NULL
 *      — i.e. DENY inside USING — for a NULL requirement, and would have locked
 *      every user including admins out of the whole extranet;
 *   4. both the predicate and the policy reach an ALREADY-initialised database,
 *      because the baseline is never replayed on one.
 *
 * To see it go red: drop the `surface_audience_allows` call from the policy's
 * USING, or delete the unknown-key branch from the predicate.
 */
const ROOT = join(__dirname, "../../..");

const PREDICATE = join(ROOT, "aisha/db/sql/functions/surface_audience_allows.sql");
const POLICY = join(ROOT, "aisha/db/sql/policies/surface_layouts_select_active.sql");
const HEALS = join(ROOT, "aisha/db/heals.sql");

const read = (p: string) => readFileSync(p, "utf8");

/** Strip SQL line comments so prose about a rule can never satisfy the rule. */
function code(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

describe("surface audience is enforced (a section is named only to who may see it)", () => {
  it("the authenticated-facing layout policy evaluates the audience declaration", () => {
    const src = code(read(POLICY));

    const using = /USING\s*\(([\s\S]*?)\);/i.exec(src);
    expect(using, "no USING clause found in the layout SELECT policy").toBeTruthy();

    // The declaration must be consulted, and it must be consulted for THIS caller.
    expect(using![1]).toMatch(/surface_audience_allows\s*\(\s*auth\.uid\(\)\s*,\s*audience\s*\)/i);

    // Permissive policies OR together, so the gate has to sit inside this policy
    // rather than beside it: a second policy would widen access, not narrow it.
    expect(using![1]).toMatch(/\bAND\b/i);
    expect(src.match(/CREATE\s+POLICY/gi)?.length ?? 0).toBe(1);
  });

  it("the predicate fails closed on a declaration it does not understand", () => {
    const src = code(read(PREDICATE));

    // Unknown key -> deny. Pinned as a property: the key set is enumerated and
    // anything outside it returns false.
    const keyLoop = /jsonb_object_keys\s*\(\s*p_audience\s*\)/i.test(src);
    expect(keyLoop, "predicate never enumerates the declaration's keys").toBe(true);
    expect(src).toMatch(/NOT\s+IN\s*\([^)]*'roles'[^)]*'min_tier'[^)]*\)[\s\S]{0,120}RETURN\s+false/i);

    // An empty declaration must pass, otherwise turning the gate on would itself
    // revoke every existing placement.
    expect(src).toMatch(/p_audience\s*=\s*'\{\}'::jsonb[\s\S]{0,80}RETURN\s+true/i);

    // Callers may only ask about themselves; the predicate is not an oracle for
    // other people's entitlements.
    expect(src).toMatch(/auth\.uid\(\)/);
    expect(src).toMatch(/is_service_role\(\)/);
  });

  it("the predicate uses the NULL-safe tier form, never the 1-arg trap", () => {
    const src = code(read(PREDICATE));

    const calls = [...src.matchAll(/audience_user_meets_tier_requirement\s*\(([^)]*)\)/gi)];
    expect(calls.length, "tier axis is declared but never evaluated").toBeGreaterThan(0);
    for (const call of calls) {
      // Two arguments = the overload with its own NULL guard, granted via this
      // DEFINER wrapper. The 1-arg form yields SQL NULL for a NULL requirement,
      // which inside USING means DENY — for everyone, admins included.
      expect(call[1].split(",").length, `1-arg tier call is the NULL trap: ${call[0]}`).toBe(2);
    }
  });

  it("both the predicate and the policy reach an already-initialised database", () => {
    const heals = code(read(HEALS));

    const fnAt = heals.indexOf("sql/functions/surface_audience_allows.sql");
    const policyAt = heals.indexOf("sql/policies/surface_layouts_select_active.sql");

    expect(fnAt, "predicate missing from heals — live DBs would never get it").toBeGreaterThan(-1);
    expect(policyAt, "policy missing from heals — the gate would stay off in production").toBeGreaterThan(-1);

    // Ordering is load-bearing: CREATE POLICY naming a function that does not
    // exist yet fails, and heals runs top to bottom on every migrate.
    expect(fnAt, "policy is healed before the function it calls").toBeLessThan(policyAt);
  });
});
