// Migrated from _platform/tests/security/ (aisha-integration retirement).
// Live-DB test — runs in audience-tests.yml against studio's aisha-db.
// ─────────────────────────────────────────────────────────────────────
// Aggregate store carries NO raw PII (SEC-F4c — audit gap)
// ─────────────────────────────────────────────────────────────────────
//
// The bulk source→aisha sync writes engagement to user_engagement_metrics. The
// seam's whole PII posture rests on this store being AGGREGATE-ONLY: the broker
// reads email + full_name to compute aggregates and resolve identity, but must
// NOT persist them here (only the federation self-login path durably stores a
// member's own email/display_name, in profiles — see SOURCE_PG_READONLY_SETUP).
//
// The 2026-06-10 coverage audit found this invariant rested on the schema + a
// comment only: a future migration adding an `email`/`name` column to the
// aggregate store would fail no test. This pins it: the table must contain none
// of the PII-shaped columns, asserted against the live catalog.
//
// STUDIO ADAPTATION: reads the live catalog via the studio DB helper
// (psqlQuery / isPgReachable → AISHA_DB_* / PG* env, default 127.0.0.1:54322)
// instead of the _platform `docker exec aisha-local__aisha-db` path. Runs
// against the cold-start pg17 DB in CI; SKIPS cleanly offline.

import { describe, it, expect, beforeAll } from "vitest";
import { psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const TABLE = "user_engagement_metrics";

// A column holds raw PII (a personal identifier VALUE) if its name is an exact
// PII name OR ends with a value-bearing PII suffix. This deliberately does NOT
// trip on aggregate EMAIL METRICS that legitimately live here — emails_sent_90d,
// emails_opened_90d, email_open_rate_90d, email_click_rate_90d are counts/rates,
// not an address. Only a stored email/name/phone/etc. value is PII.
const PII_EXACT = new Set([
  "email", "name", "phone", "mobile", "contact", "birthday", "dob",
  "date_of_birth", "address", "street", "city", "postal_code", "username",
]);
const PII_SUFFIX = ["_email", "_name", "_phone", "_address", "_contact"];
function isPiiColumn(col: string): boolean {
  const c = col.toLowerCase();
  return PII_EXACT.has(c) || PII_SUFFIX.some((s) => c.endsWith(s));
}

describe("aggregate store has no raw PII columns", () => {
  let columns: string[] = [];
  let tablePresent = false;

  beforeAll(async () => {
    await reportTestCapabilities("audience aggregate-store no-PII");
    if (!dbAvailable) return;
    const out = psqlQuery(
      `SELECT column_name FROM information_schema.columns ` +
        `WHERE table_schema='public' AND table_name='${TABLE}' ORDER BY ordinal_position;`,
    );
    columns = out ? out.split("\n").map((c) => c.trim()).filter(Boolean) : [];
    tablePresent = columns.length > 0;
  });

  it.skipIf(!dbAvailable)(`${TABLE} exists (apply migrations if this fails)`, () => {
    expect(tablePresent, `${TABLE} not found on the live DB`).toBe(true);
  });

  it.skipIf(!dbAvailable)(
    "has NO column holding raw PII (address/name/phone/…), email METRICS are fine",
    () => {
      if (!tablePresent) return;
      const offenders = columns.filter(isPiiColumn);
      expect(
        offenders,
        `Aggregate store ${TABLE} gained PII-bearing column(s): ${offenders.join(", ")}. ` +
          `Raw PII must not cross the bulk-sync seam — keep this store aggregate-only ` +
          `(email open/click RATES are ok; an email ADDRESS is not).`,
      ).toEqual([]);
    },
  );

  it.skipIf(!dbAvailable)("still carries the expected aggregate shape (user_id + metric columns)", () => {
    if (!tablePresent) return;
    // Sanity: the table is the real aggregate store, not an empty/renamed stub.
    expect(columns).toContain("user_id");
    expect(columns.some((c) => c.includes("app_accesses") || c.includes("audience_size"))).toBe(true);
  });
});
