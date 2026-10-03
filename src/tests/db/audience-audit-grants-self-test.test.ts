// Migrated from _platform/tests/security/ (aisha-integration retirement).
// Live-DB test — runs in audience-tests.yml against studio's aisha-db.
// ─────────────────────────────────────────────────────────────────────
// audience_audit_grants() actually fires (SEC-FIN — audit gap)
// ─────────────────────────────────────────────────────────────────────
//
// audience_audit_grants() is the grant-invariant engine the cold-start gate now
// runs to keep the audience PII surface least-privilege. Its consumers only
// assert "0 CRITICAL/HIGH" — so a silently-empty invariant clause would report
// the grant model OK over a wide-open catalog. This proves the auditor is NOT
// vacuous: injecting a real violation (anon EXECUTE on an audience admin RPC)
// makes a CRITICAL/HIGH finding appear, and removing it makes it vanish — all
// inside a rolled-back txn.
//
// STUDIO ADAPTATION: drives the DB via the studio helpers (psqlQuery /
// psqlMultiline / isPgReachable → AISHA_DB_* / PG* env, default
// 127.0.0.1:54322) instead of the _platform `docker exec aisha-local__aisha-db`
// path. Runs against the cold-start pg17 DB in CI; SKIPS cleanly offline.

import { describe, it, expect, beforeAll } from "vitest";
import { psqlQuery, psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();

describe("audience_audit_grants() is a live, non-vacuous invariant", () => {
  let out = "";
  let auditorPresent = false;

  beforeAll(async () => {
    await reportTestCapabilities("audience_audit_grants self-test");
    if (!dbAvailable) return;
    auditorPresent =
      psqlQuery(`SELECT count(*) FROM pg_proc WHERE proname='audience_audit_grants';`).trim() === "1";
    if (!auditorPresent) return;

    // Resolve a real audience SECURITY DEFINER admin RPC signature.
    const fn = psqlQuery(
      `SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace ` +
        `WHERE n.nspname='public' AND p.proname LIKE 'audience_admin_%' AND p.prosecdef ORDER BY p.proname LIMIT 1;`,
    ).trim();
    // Inject the I2_anon_execute violation; measure before/after on STDOUT
    // (SELECT, not RAISE NOTICE — the latter goes to stderr). Rolled back.
    out = psqlMultiline(`
BEGIN;
SELECT 'before=' || count(*) FROM public.audience_audit_grants() WHERE severity IN ('CRITICAL','HIGH');
GRANT EXECUTE ON FUNCTION ${fn} TO anon;
SELECT 'during=' || count(*) FROM public.audience_audit_grants() WHERE severity IN ('CRITICAL','HIGH');
ROLLBACK;
`);
  });

  it.skipIf(!dbAvailable)("the auditor fn exists (apply migrations if this fails)", () => {
    expect(auditorPresent).toBe(true);
  });

  it.skipIf(!dbAvailable)("reports a clean baseline (0 CRITICAL/HIGH) before injection", () => {
    if (!auditorPresent) return;
    expect(out).toMatch(/before=0/);
  });

  it.skipIf(!dbAvailable)("FIRES a CRITICAL/HIGH finding when anon gains EXECUTE on an audience RPC", () => {
    if (!auditorPresent) return;
    const m = out.match(/during=(\d+)/);
    expect(m, `no probe output:\n${out}`).toBeTruthy();
    expect(Number(m![1]), "auditor must detect the injected anon-EXECUTE violation").toBeGreaterThan(0);
  });
});
