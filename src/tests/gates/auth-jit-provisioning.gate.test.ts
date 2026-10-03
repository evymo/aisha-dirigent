/**
 * @file auth-jit-provisioning.gate.test.ts
 * Static contract gate for the first-request user-provisioning fix (FK 23503).
 *
 * Guards the invariants that keep authenticated-but-unprovisioned Keycloak
 * users from FK-violating on their first write:
 *   1. ensure_current_user exists, is SECURITY DEFINER, and can reach
 *      aisha_auth (search_path) to insert the registry anchor.
 *   2. write_audit_journal coalesces an unknown actor to NULL (audit must
 *      never roll back the operation it records).
 *   3. update_notification_preferences provisions before its NOT NULL insert.
 *   4. The aisha_auth.users INSERT trigger that wires role+profile still
 *      exists (ensure_current_user relies on it).
 *
 * Run: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf-8");

describe("Auth JIT provisioning — FK 23503 fix contract", () => {
  it("ensure_current_user is SECURITY DEFINER, reaches aisha_auth, idempotent insert", () => {
    const src = read("aisha/db/sql/functions/ensure_current_user.sql");
    expect(src).toContain("SECURITY DEFINER");
    // Must include aisha_auth in search_path to resolve the cross-schema insert
    expect(src).toMatch(/SET search_path TO 'public', 'aisha_auth'/);
    expect(src).toContain("INSERT INTO aisha_auth.users");
    expect(src).toContain("ON CONFLICT (id) DO NOTHING");
    // Returns NULL for anonymous callers (no subject to provision)
    expect(src).toContain("IF v_uid IS NULL");
    expect(src).toContain("GRANT EXECUTE ON FUNCTION public.ensure_current_user(text) TO authenticated");
  });

  it("write_audit_journal coalesces unknown actor to NULL (never blocks)", () => {
    const src = read("aisha/db/sql/functions/write_audit_journal.sql");
    // The defensive guard: NOT EXISTS in aisha_auth.users → user_id := NULL
    expect(src).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM aisha_auth\.users u WHERE u\.id = v_actual_user_id\s*\)/,
    );
    expect(src).toMatch(/v_actual_user_id := NULL/);
  });

  it("update_notification_preferences JIT-provisions before its NOT NULL insert", () => {
    const src = read("aisha/db/sql/functions/update_notification_preferences.sql");
    expect(src).toContain("PERFORM public.ensure_current_user()");
    // The provision must precede the INSERT that hits the NOT NULL FK
    const provisionIdx = src.indexOf("ensure_current_user");
    const insertIdx = src.indexOf("INSERT INTO notification_preferences");
    expect(provisionIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(provisionIdx);
  });

  it("the aisha_auth.users provisioning trigger ensure_current_user relies on still exists", () => {
    const trg = read("aisha/db/sql/triggers/on_auth_user_created.sql");
    expect(trg).toContain("AFTER INSERT ON aisha_auth.users");
    expect(trg).toContain("handle_new_user");
    const fn = read("aisha/db/sql/functions/handle_new_user.sql");
    expect(fn).toContain("INSERT INTO public.user_roles");
    expect(fn).toContain("INSERT INTO public.profiles");
  });
});
