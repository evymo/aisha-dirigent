/**
 * Proposal Outcome Measurement Gate (PR 5) — the self-improvement loop closer.
 *
 * After an improvement_proposal is applied, fn_record_proposal_outcome measures
 * the story self-eval maturity score before vs after. On regression it PROPOSES
 * a gated rollback (advisory-only) — it never executes one. WF_PROPOSAL_OUTCOME_REVIEW
 * (cron) drives the two-phase measurement.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { N8nNode } from "./_types";

const ROOT = process.cwd();
const TABLE = path.join(ROOT, "aisha/db/sql/tables/improvement_proposals.sql");
const REC = path.join(ROOT, "aisha/db/sql/functions/fn_record_proposal_outcome.sql");
const LIST = path.join(ROOT, "aisha/db/sql/functions/fn_get_proposals_due_outcome_review.sql");
const WF = path.join(ROOT, "n8n/workflows/WF_PROPOSAL_OUTCOME_REVIEW.json");
const MIG = path.join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");

describe("Proposal outcome: schema + recorder SoT", () => {
  it("improvement_proposals has an outcome jsonb column", () => {
    expect(fs.readFileSync(TABLE, "utf-8")).toMatch(/\boutcome\s+jsonb/i);
  });

  it("fn_record_proposal_outcome: SECURITY DEFINER, service_role-safe, measures via maturity, two-phase", () => {
    const sql = fs.readFileSync(REC, "utf-8");
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_record_proposal_outcome/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql, "service_role-safe").toMatch(/current_setting\(\s*'role'\s*,\s*true\s*\)\s*=\s*'service_role'/i);
    expect(sql, "measures via get_story_aisha_maturity").toMatch(/get_story_aisha_maturity/);
    for (const k of ["score_before", "score_after", "score_delta", "regressed"]) {
      expect(sql, `outcome must record ${k}`).toContain(k);
    }
    expect(sql).toMatch(/GRANT\s+EXECUTE[^;]*TO\s+service_role/i);
  });

  it("on regression it PROPOSES a gated rollback (advisory-only) — never executes", () => {
    const sql = fs.readFileSync(REC, "utf-8");
    expect(sql, "regression must create a rollback proposal").toMatch(/fn_create_improvement_proposal/);
    expect(sql, "rollback proposal category").toMatch(/'rollback'/);
    // must NOT execute a rollback itself
    expect(/request_rollback|update_rollback_status/.test(sql), "outcome recorder must not execute rollback").toBe(false);
  });

  it("fn_get_proposals_due_outcome_review exists and is service_role-scoped", () => {
    const sql = fs.readFileSync(LIST, "utf-8");
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_get_proposals_due_outcome_review/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE[^;]*TO\s+service_role/i);
    expect(sql, "lister must not be exposed to plain authenticated users").not.toMatch(
      /GRANT\s+EXECUTE[^;]*TO\s+authenticated/i,
    );
  });
});

describe("Proposal outcome: cron workflow + migration", () => {
  it("WF_PROPOSAL_OUTCOME_REVIEW is a scheduled cron calling both RPCs (service_role, fail-open)", () => {
    const wf = JSON.parse(fs.readFileSync(WF, "utf-8"));
    expect(
      (wf.nodes || []).some((n: N8nNode) => n.type === "n8n-nodes-base.scheduleTrigger"),
      "must be cron-triggered",
    ).toBe(true);
    const rpcs = (wf.nodes || []).filter((n: N8nNode) => n.type === "n8n-nodes-aisha.aishaRpc");
    const fns = rpcs.map((n: N8nNode) => n.parameters?.functionName);
    expect(fns).toContain("fn_get_proposals_due_outcome_review");
    expect(fns).toContain("fn_record_proposal_outcome");
    for (const r of rpcs) {
      expect(r.parameters?.authMode).toBe("service_role");
      expect(r.onError ?? r.parameters?.onError).toBe("continueRegularOutput");
    }
  });

  it("proposal outcome is column + functions only (no dedicated table)", () => {
    // The lens/loop adds an `outcome jsonb` column to improvement_proposals plus
    // functions — NO new table. The migration was folded into the baseline, so
    // assert there is no dedicated proposal_outcome table in the canonical SoT.
    const hasDedicatedTable =
      fs.existsSync(path.join(ROOT, "aisha/db/sql/tables/proposal_outcome.sql")) ||
      fs.existsSync(path.join(ROOT, "aisha/db/sql/tables/proposal_outcomes.sql"));
    expect(hasDedicatedTable, "PR 5 must not add a new table").toBe(false);
  });
});
