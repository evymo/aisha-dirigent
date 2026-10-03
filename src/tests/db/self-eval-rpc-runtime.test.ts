/**
 * Self-Eval RPC Runtime (clean seeded stack)
 *
 * Functional / behavioral coverage of the story self-evaluation LENS, run against
 * a real PostgreSQL that has the baseline + every delta + the full seed applied
 * (cold-start + seed.compiled.sql — NOT the stale dev DB). The signals come from
 * the SoT fixture aisha/db/seed/demo/04_self_eval_showcase.sql.
 *
 * Complements the offline contract gates (src/tests/gates/*self-eval*,
 * *proposal-outcome*) which only parse SQL/JSON structure. Here we assert the
 * RPCs actually READ + AGGREGATE the seeded signals and that the
 * regression → gated-rollback loop closes.
 *
 * Skips cleanly when no PostgreSQL is reachable OR the showcase fixture is not
 * seeded (so a bare cold-start without seeds does not fail the suite). Point at
 * the clean stack via AISHA_DB_HOST/PORT/USER/PASSWORD/NAME (see test-env-probe).
 *
 * Roles per call follow the verified grant posture:
 *   evaluate_story_self / verdict view / due-review / record-outcome → service_role
 *   get_story_aisha_maturity → authenticated (svc lacks EXECUTE; definer reads anyway)
 */

import { beforeAll, describe, expect, it } from "vitest";
import { psqlQuery, psqlQueryAs, psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

// Fixed fixture UUIDs (aisha/db/seed/demo/04_self_eval_showcase.sql).
const STORY_A = "5e1f5e1f-0000-4000-8000-000000000001"; // healthy showcase
const STORY_B = "5e1f5e1f-0000-4000-8000-000000000002"; // regression scenario
const PROP_A = "5e1f5e1f-0000-4000-8000-00000000010a"; // applied, baseline due
const PROP_B = "5e1f5e1f-0000-4000-8000-00000000020b"; // open proposal
const PROP_C = "5e1f5e1f-0000-4000-8000-00000000030c"; // applied, regresses

const dbAvailable = isPgReachable();

/** Reachable AND the showcase fixture is seeded (skip otherwise — don't fail). */
function fixtureSeeded(): boolean {
  if (!dbAvailable) return false;
  try {
    return (
      psqlQuery(`SELECT count(*) FROM public.partner_stories WHERE id = '${STORY_A}'`) === "1"
    );
  } catch {
    return false;
  }
}
const seeded = fixtureSeeded();

/**
 * Run a single SELECT under a specific role; returns the scalar text result.
 * Delegates to psqlQueryAs, which assumes the role at connection time (role GUC)
 * rather than an in-band `SET ROLE x; <select>` — the latter makes psql ≥15 emit
 * a `SET` command tag that corrupts the scalar (`SET\n<value>`). See psqlQueryAs.
 */
function asRole(role: string, selectExpr: string): string {
  return psqlQueryAs(role, selectExpr);
}

beforeAll(async () => {
  await reportTestCapabilities("Self-Eval RPC Runtime");
  if (dbAvailable && !seeded) {
    console.log(
      "ℹ️  Self-Eval RPC Runtime: DB reachable but showcase fixture absent — apply seed.compiled.sql (demo/04_self_eval_showcase.sql) to enable these tests.",
    );
  }
  // Reset the mutating proposals to their pristine fixture state at suite start
  // so read-only AND mutating tests are deterministic on re-run (ON CONFLICT
  // seeds never overwrite an already-mutated row).
  if (seeded) {
    psqlMultiline(`
      UPDATE public.improvement_proposals SET outcome = NULL WHERE id = '${PROP_A}';
      UPDATE public.improvement_proposals
         SET outcome = '{"score_before": 90.0, "baseline_at": "2026-05-20T00:00:00Z"}'::jsonb
       WHERE id = '${PROP_C}';
      DELETE FROM public.improvement_proposals
       WHERE category = 'rollback' AND metadata->>'regressed_proposal_id' = '${PROP_C}';
    `);
  }
});

// =============================================================================
// 1) get_story_aisha_maturity — composite from seeded signals (authenticated)
// =============================================================================
describe("get_story_aisha_maturity (Story A, seeded)", () => {
  it.skipIf(!seeded)("returns 'expert' level with the seeded component counts", () => {
    const row = asRole(
      "authenticated",
      `SELECT
         (m->>'maturity_level')            || '|' ||
         (m->>'webhook_events_count')      || '|' ||
         (m->>'deployments_count')         || '|' ||
         (m->>'compliance_pass_rate')      || '|' ||
         (m->>'learning_proposals_count')  || '|' ||
         (m->>'maturity_score')
       FROM (SELECT public.get_story_aisha_maturity('${STORY_A}'::uuid) AS m) s`,
    );
    const [level, webhooks, deploys, compliance, learning, score] = row.split("|");
    expect(level).toBe("expert");
    expect(webhooks).toBe("2");
    expect(deploys).toBe("1");
    expect(parseFloat(compliance)).toBeCloseTo(1.0, 4);
    expect(learning).toBe("2");
    expect(parseFloat(score)).toBeGreaterThan(90);
  });
});

// =============================================================================
// 2) selfeval_story_verdict_v — per-dimension aggregates (service_role only)
// =============================================================================
describe("selfeval_story_verdict_v (Story A, seeded)", () => {
  it.skipIf(!seeded)("aggregates faithfulness/drift/incidents/proposals from signals", () => {
    const row = asRole(
      "service_role",
      `SELECT faithfulness_avg ||'|'|| faithfulness_n ||'|'|| open_drift_count ||'|'||
              open_drift_high  ||'|'|| sentry_fatal_30d ||'|'|| open_proposals ||'|'|| applied_proposals_30d
       FROM public.selfeval_story_verdict_v WHERE story_id = '${STORY_A}'::uuid`,
    );
    const [fAvg, fN, drift, driftHigh, sentry, openP, appliedP] = row.split("|");
    expect(parseFloat(fAvg)).toBeCloseTo(0.92, 2);
    expect(fN).toBe("1");
    expect(drift).toBe("1");
    expect(driftHigh).toBe("1");
    expect(sentry).toBe("2");
    expect(openP).toBe("1");
    expect(appliedP).toBe("1");
  });
});

// =============================================================================
// 3) evaluate_story_self — composed 5-dim verdict + generic (backend) seam
// =============================================================================
describe("evaluate_story_self (Story A, seeded)", () => {
  it.skipIf(!seeded)("composes the five lens dimensions", () => {
    const dims = asRole(
      "service_role",
      `SELECT string_agg(d->>'key', ',' ORDER BY d->>'key')
       FROM jsonb_array_elements(public.evaluate_story_self('${STORY_A}'::uuid)->'dimensions') d`,
    );
    for (const key of ["drift", "faithfulness", "goal", "incidents", "maturity"]) {
      expect(dims).toContain(key);
    }
  });

  it.skipIf(!seeded)("surfaces the seeded signals in the verdict evidence", () => {
    const faith = asRole(
      "service_role",
      `SELECT d->'evidence'->>'avg'
       FROM jsonb_array_elements(public.evaluate_story_self('${STORY_A}'::uuid)->'dimensions') d
       WHERE d->>'key' = 'faithfulness'`,
    );
    expect(parseFloat(faith)).toBeCloseTo(0.92, 2);

    const fatal = asRole(
      "service_role",
      `SELECT d->'evidence'->>'sentry_fatal_30d'
       FROM jsonb_array_elements(public.evaluate_story_self('${STORY_A}'::uuid)->'dimensions') d
       WHERE d->>'key' = 'incidents'`,
    );
    expect(fatal).toBe("2");

    const level = asRole(
      "service_role",
      `SELECT public.evaluate_story_self('${STORY_A}'::uuid)->>'level'`,
    );
    expect(level).toBe("expert");
  });

  it.skipIf(!seeded)("defaults backend to 'origin' and honors an explicit backend (generic seam)", () => {
    const def = asRole(
      "service_role",
      `SELECT public.evaluate_story_self('${STORY_A}'::uuid)->>'backend'`,
    );
    expect(def).toBe("origin");
    const explicit = asRole(
      "service_role",
      `SELECT public.evaluate_story_self('${STORY_A}'::uuid, 'acme-repo')->>'backend'`,
    );
    expect(explicit).toBe("acme-repo");
  });
});

// =============================================================================
// 4) fn_get_proposals_due_outcome_review — read-only (run BEFORE mutations)
// =============================================================================
describe("fn_get_proposals_due_outcome_review (seeded)", () => {
  it.skipIf(!seeded)("lists applied proposals with the right next phase", () => {
    const due = asRole(
      "service_role",
      `SELECT string_agg(proposal_id::text || ':' || phase, ',' ORDER BY proposal_id::text)
       FROM public.fn_get_proposals_due_outcome_review()`,
    );
    expect(due).toContain(`${PROP_A}:baseline`); // applied, no score_before yet
    expect(due).toContain(`${PROP_C}:outcome`); // applied, score_before set + window elapsed
    expect(due).not.toContain(PROP_B); // 'proposed' (not applied) → never due
  });
});

// =============================================================================
// 5) Grant posture — least-privilege (anon blocked everywhere)
// =============================================================================
describe("self-eval RPC grant posture", () => {
  it.skipIf(!dbAvailable)("evaluate_story_self: anon blocked, authenticated + service_role allowed", () => {
    const row = psqlQuery(
      `SELECT has_function_privilege('anon','public.evaluate_story_self(uuid,text)','EXECUTE') ||'|'||
              has_function_privilege('authenticated','public.evaluate_story_self(uuid,text)','EXECUTE') ||'|'||
              has_function_privilege('service_role','public.evaluate_story_self(uuid,text)','EXECUTE')`,
    );
    expect(row).toBe("false|true|true");
  });

  it.skipIf(!dbAvailable)("verdict view + due-review are service_role-only (admin data)", () => {
    const view = psqlQuery(
      `SELECT has_table_privilege('anon','public.selfeval_story_verdict_v','SELECT') ||'|'||
              has_table_privilege('authenticated','public.selfeval_story_verdict_v','SELECT') ||'|'||
              has_table_privilege('service_role','public.selfeval_story_verdict_v','SELECT')`,
    );
    expect(view).toBe("false|false|true");

    const due = psqlQuery(
      `SELECT has_function_privilege('anon','public.fn_get_proposals_due_outcome_review(int,int)','EXECUTE') ||'|'||
              has_function_privilege('authenticated','public.fn_get_proposals_due_outcome_review(int,int)','EXECUTE') ||'|'||
              has_function_privilege('service_role','public.fn_get_proposals_due_outcome_review(int,int)','EXECUTE')`,
    );
    expect(due).toBe("false|false|true");
  });
});

// =============================================================================
// 6+7) fn_record_proposal_outcome — baseline + regression → gated rollback
//      (MUTATING — kept last so read-only asserts above see pristine fixture)
// =============================================================================
describe("fn_record_proposal_outcome (seeded, mutating)", () => {
  it.skipIf(!seeded)("phase 1 snapshots a baseline score for an applied proposal", () => {
    const phase = asRole(
      "service_role",
      `SELECT public.fn_record_proposal_outcome('${PROP_A}'::uuid)->>'phase'`,
    );
    expect(phase).toBe("baseline");
    const scoreBefore = asRole(
      "service_role",
      `SELECT outcome->>'score_before' FROM public.improvement_proposals WHERE id = '${PROP_A}'::uuid`,
    );
    expect(parseFloat(scoreBefore)).toBeGreaterThan(0);
  });

  it.skipIf(!seeded)("phase 2 detects a regression and PROPOSES a gated rollback (loop closes)", () => {
    const rollbackBefore = parseInt(
      asRole("service_role", `SELECT count(*) FROM public.improvement_proposals WHERE category = 'rollback'`),
      10,
    );

    const result = asRole(
      "service_role",
      `SELECT (o->>'phase') || '|' || (o->>'regressed')
       FROM (SELECT public.fn_record_proposal_outcome('${PROP_C}'::uuid) AS o) s`,
    );
    const [phase, regressed] = result.split("|");
    expect(phase).toBe("outcome");
    expect(regressed).toBe("true");

    const rollbackAfter = parseInt(
      asRole("service_role", `SELECT count(*) FROM public.improvement_proposals WHERE category = 'rollback'`),
      10,
    );
    expect(rollbackAfter).toBeGreaterThan(rollbackBefore);

    // the gated rollback proposal references the regressed proposal + its story scope
    const linked = asRole(
      "service_role",
      `SELECT count(*) FROM public.improvement_proposals
       WHERE category = 'rollback'
         AND metadata->>'regressed_proposal_id' = '${PROP_C}'
         AND metadata->>'story_id' = '${STORY_B}'`,
    );
    expect(parseInt(linked, 10)).toBeGreaterThanOrEqual(1);
  });
});
