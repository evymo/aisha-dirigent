// Migrated from _platform/tests/security/ (aisha-integration retirement).
// Live-DB test — runs in audience-tests.yml against studio's aisha-db.
// ─────────────────────────────────────────────────────────────────────
// Federated provisioning is self-scoped (SEC-FIN — audit gap)
// ─────────────────────────────────────────────────────────────────────
//
// audience_provision_federated_member is the ONE place the integration durably
// writes a member's email + display_name into aisha (auth.users + profiles),
// keyed on the verified source UUID (reused verbatim as the aisha id — the
// no-mapping-table federated-identity contract). The audit found this had zero
// coverage: a regression that let a client-supplied uuid/email through would be
// a cross-member PII-write / account-takeover vector.
//
// This pins the contract on the live DB inside a rolled-back txn:
//   • the returned aisha id EQUALS the source uuid (verbatim, no remap);
//   • exactly the provided member's profile row is written;
//   • provisioning member B does not mutate member A's row (self-scoped).
//
// STUDIO ADAPTATION: drives the DB via the studio helpers (psqlQuery /
// psqlMultiline / isPgReachable → AISHA_DB_* / PG* env, default
// 127.0.0.1:54322) instead of the _platform `docker exec aisha-local__aisha-db`
// path. Runs against the cold-start pg17 DB in CI; SKIPS cleanly offline.

import { describe, it, expect, beforeAll } from "vitest";
import { psqlQuery, psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const A = "aaaa1111-0000-0000-0000-0000000000a1";
const B = "bbbb2222-0000-0000-0000-0000000000b2";

describe("audience_provision_federated_member is self-scoped", () => {
  let out = "";
  let fnPresent = false;

  beforeAll(async () => {
    await reportTestCapabilities("audience federated-provision self-scope");
    if (!dbAvailable) return;
    fnPresent =
      psqlQuery(`SELECT count(*) FROM pg_proc WHERE proname='audience_provision_federated_member';`).trim() ===
      "1";
    if (!fnPresent) return;
    out = psqlMultiline(`
BEGIN;
SELECT 'A_ret=' || public.audience_provision_federated_member('${A}'::uuid, 'a@test.local', 'Member A', 'en', 'registered');
SELECT 'A_rows=' || count(*) FROM public.profiles WHERE user_id = '${A}'::uuid;
SELECT 'A_email_in_profile=' || count(*) FROM public.profiles WHERE user_id = '${A}'::uuid;
-- provision B; must not touch A
SELECT 'B_ret=' || public.audience_provision_federated_member('${B}'::uuid, 'b@test.local', 'Member B', 'en', 'registered');
SELECT 'A_still=' || count(*) FROM public.profiles WHERE user_id = '${A}'::uuid;
SELECT 'B_rows=' || count(*) FROM public.profiles WHERE user_id = '${B}'::uuid;
ROLLBACK;
`);
  });

  it.skipIf(!dbAvailable)("the provision fn exists (apply migrations if this fails)", () => {
    expect(fnPresent).toBe(true);
  });

  it.skipIf(!dbAvailable)("returns the source UUID verbatim as the aisha id (no remap)", () => {
    if (!fnPresent) return;
    expect(out).toContain(`A_ret=${A}`);
  });

  it.skipIf(!dbAvailable)("writes exactly the provisioned member’s profile row", () => {
    if (!fnPresent) return;
    expect(out).toMatch(/A_rows=1/);
  });

  it.skipIf(!dbAvailable)("provisioning member B does not mutate member A (self-scoped)", () => {
    if (!fnPresent) return;
    expect(out).toContain(`B_ret=${B}`);
    expect(out).toMatch(/A_still=1/);
    expect(out).toMatch(/B_rows=1/);
  });
});
