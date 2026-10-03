// Migrated from _platform/tests/security/ (aisha-integration retirement).
// Live-DB test — runs in audience-tests.yml against studio's aisha-db.
// ─────────────────────────────────────────────────────────────────────
// Per-member data isolation: member A cannot see member B (SEC-F4c — audit gap)
// ─────────────────────────────────────────────────────────────────────
//
// The user's central question: does a federated member get ONLY their own
// information? Isolation rests on the RLS self-read policy on the engagement
// store — user_engagement_metrics_self_read USING (user_id = auth.uid()) — and
// the operator views being admin-only (covered separately). The 2026-06-10
// audit found NO test proving the negative side: that member A, querying as
// PostgREST would (SET ROLE authenticated + jwt.claims.sub), is BLOCKED from
// member B's row. This pins it with a two-member fixture, fully inside a
// transaction that ROLLs BACK (no persistent mutation of the live DB).
//
// STUDIO ADAPTATION: connects via the studio DB helpers (psqlMultiline /
// isPgReachable → AISHA_DB_* / PG* env, default 127.0.0.1:54322) instead of the
// _platform `docker exec aisha-local__aisha-db` path. In studio CI it runs
// against the cold-start pg17 DB (coldstart-db-gate provisions AISHA_DB_*);
// offline it SKIPS cleanly (isPgReachable() is false — no live DB).

import { describe, it, expect, beforeAll } from "vitest";
import { psqlQuery, psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";

// One transaction: insert A+B engagement rows, then read as each member through
// the authenticated role + jwt.claims (exactly the PostgREST RLS path), then
// ROLLBACK. Emits tagged lines we parse.
function isolationProbe(): string {
  const claims = (sub: string) => `{"sub":"${sub}","role":"authenticated"}`;
  return psqlMultiline(`
BEGIN;
INSERT INTO public.user_engagement_metrics (user_id, source_slug, computed_at, updated_at)
VALUES ('${A}'::uuid, 'isolation-test', now(), now()),
       ('${B}'::uuid, 'isolation-test', now(), now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '${claims(A)}', true);
SELECT 'A_own=' || count(*) FROM public.user_engagement_metrics WHERE user_id = '${A}'::uuid;
SELECT 'A_sees_B=' || count(*) FROM public.user_engagement_metrics WHERE user_id = '${B}'::uuid;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '${claims(B)}', true);
SELECT 'B_own=' || count(*) FROM public.user_engagement_metrics WHERE user_id = '${B}'::uuid;
SELECT 'B_sees_A=' || count(*) FROM public.user_engagement_metrics WHERE user_id = '${A}'::uuid;
RESET ROLE;
ROLLBACK;
`);
}

describe("per-member data isolation (RLS self-read)", () => {
  let out = "";
  let policyPresent = false;

  beforeAll(async () => {
    await reportTestCapabilities("audience per-member data isolation");
    if (!dbAvailable) return;
    // Preconditions: the table + the authenticated role + the self-read policy.
    const ok = psqlQuery(
      `SELECT count(*) FROM pg_policies WHERE tablename='user_engagement_metrics' ` +
        `AND policyname='user_engagement_metrics_self_read';`,
    ).trim();
    policyPresent = ok === "1";
    if (policyPresent) out = isolationProbe();
  });

  it.skipIf(!dbAvailable)("self-read RLS policy exists (apply migrations if this fails)", () => {
    expect(policyPresent, "user_engagement_metrics_self_read policy not found").toBe(true);
  });

  it.skipIf(!dbAvailable)("member A sees their OWN engagement row", () => {
    if (!policyPresent) return;
    expect(out).toMatch(/A_own=1/);
  });

  it.skipIf(!dbAvailable)("member A CANNOT see member B’s row (cross-member isolation)", () => {
    if (!policyPresent) return;
    expect(out, `A leaked into B's data:\n${out}`).toMatch(/A_sees_B=0/);
  });

  it.skipIf(!dbAvailable)("member B sees own + CANNOT see member A (symmetric)", () => {
    if (!policyPresent) return;
    expect(out).toMatch(/B_own=1/);
    expect(out, `B leaked into A's data:\n${out}`).toMatch(/B_sees_A=0/);
  });
});
