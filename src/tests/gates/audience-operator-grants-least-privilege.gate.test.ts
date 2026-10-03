/**
 * Gate: audience operator relations are never anon-readable (SEC-F4b least-privilege).
 *
 * The audience operator views + the audience_broker_sync_state table aggregate
 * PII across ALL members. Members reach only their own slice, and only via the
 * audience_get_my_* SECURITY DEFINER RPCs — never these relations directly. The
 * platform's OWN invariant audience_audit_grants() I3 classifies anon SELECT on
 * any audience relation as CRITICAL.
 *
 * This is the STATIC fast-feedback guard for that contract. The authoritative
 * DB-level guard (which catches role-membership reachability + the runtime effect
 * of the blanket grant loop) runs audience_audit_grants() against the ASSEMBLED
 * baseline in scripts/db/verify-cold-start-apply.sh.
 *
 * Root cause it guards: aisha/db/sql/grants/fix_missing_table_grants.sql loops over
 * EVERY pg_tables row granting anon SELECT. It sorts AFTER the per-object grant
 * files, so without the audience%/cohort exclusion it silently re-grants anon
 * SELECT on audience_broker_sync_state on every cold-start — overriding the
 * per-object revoke and re-introducing exactly what SEC-F4b (20260610180000)
 * hardened. The exclusion keeps the blanket grant aligned with invariant I3.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");

const GRANTS_DIR = "aisha/db/sql/grants";
const BASELINE = "aisha/db/migrations/00000000000000_baseline.sql";

// The 13 audience operator views hardened by SEC-F4b (migration 20260610180000).
const OPERATOR_VIEWS = [
  "audience_actor_overlay_v",
  "audience_actor_tier_v",
  "audience_admin_accounts_v",
  "audience_admin_activities_v",
  "audience_admin_actor_detail_v",
  "audience_admin_campaign_performance_v",
  "audience_admin_cohort_overview_v",
  "audience_admin_communication_log_v",
  "audience_admin_contact_directory_v",
  "audience_admin_followup_queue_v",
  "audience_admin_signal_feed_v",
  "audience_admin_teachers_v",
  "audience_admin_tier_funnel_v",
];

describe("Audience operator relations — anon least-privilege (SEC-F4b)", () => {
  test("fix_missing_table_grants.sql excludes the audience%/cohort class from the blanket anon SELECT loop", () => {
    const sql = read(`${GRANTS_DIR}/fix_missing_table_grants.sql`);
    // The anon grant inside the pg_tables loop MUST be guarded so privileged
    // audience/cohort relations never receive a blanket anon SELECT. Aligned with
    // the WHERE clause of audience_audit_grants() invariant I3.
    expect(
      sql,
      "blanket anon SELECT loop must skip audience% relations (invariant I3)",
    ).toMatch(/NOT LIKE 'audience%'/);
    expect(
      sql,
      "blanket anon SELECT loop must skip cohorts/cohort_arms + invitations (invariant I3 + audit C2: invitation code/role/PII must not be anon-readable, else the loop silently re-grants it every cold-start)",
    ).toMatch(/NOT IN \('cohorts',\s*'cohort_arms',\s*'invitations'\)/);
  });

  test("no SoT grant file grants anon or authenticated SELECT on an audience operator view", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(join(ROOT, GRANTS_DIR))) {
      if (!f.endsWith(".sql")) continue;
      const body = read(`${GRANTS_DIR}/${f}`);
      for (const v of OPERATOR_VIEWS) {
        const re = new RegExp(
          `GRANT[^;]*\\bSELECT\\b[^;]*\\b${v}\\b[^;]*\\bTO\\b[^;]*\\b(anon|authenticated)\\b`,
          "i",
        );
        if (re.test(body)) offenders.push(`${f} → ${v}`);
      }
    }
    expect(
      offenders,
      `operator views must never be granted to anon/authenticated (members use audience_get_my_* RPCs):\n  ${offenders.join("\n  ")}`,
    ).toHaveLength(0);
  });

  test("audience_broker_sync_state grants no privilege to anon", () => {
    const body = read(`${GRANTS_DIR}/audience_broker_sync_state.sql`);
    expect(
      /\bTO anon\b/.test(body),
      "audience_broker_sync_state must grant anon nothing — it is an RLS-fragile PII aggregate (invariant I3)",
    ).toBe(false);
  });

  test("the generated baseline carries no anon/authenticated SELECT on operator views or the broker table", () => {
    const base = read(BASELINE);
    const reView = new RegExp(
      `GRANT SELECT ON public\\.(?:${OPERATOR_VIEWS.join("|")}) TO (?:anon|authenticated)`,
    );
    expect(
      reView.test(base),
      "baseline must not GRANT SELECT on any audience operator view to anon/authenticated",
    ).toBe(false);
    expect(
      /GRANT[^;]*\bON public\.audience_broker_sync_state\b[^;]*\bTO anon\b/.test(base),
      "baseline must not grant anon any privilege on audience_broker_sync_state",
    ).toBe(false);
  });
});
