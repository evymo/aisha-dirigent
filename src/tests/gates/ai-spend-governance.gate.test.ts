/**
 * @file ai-spend-governance.gate.test.ts
 * Static contract gate for the spend-governance lens (estimate → policy →
 * allow/ask/deny). Guards the invariants the runtime depends on:
 *
 *   1. SoT pairs exist (tables + RPCs + seed) and stay structurally sound.
 *   2. Admission points actually call fn_authorize_task_spend — the gate
 *      that died silently once before (blocked runs executed anyway).
 *   3. Catalog seed bands are coherent (p50 <= p90) so the zero-config
 *      thresholds (allow under p90, deny above 3×p90) stay meaningful.
 *   4. The reflection runner refuses blocked runs.
 *
 * Run: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

describe("AI Spend Governance — contract gate", () => {
  describe("SoT pairs", () => {
    it("catalog + policies tables exist with the structural constraints", () => {
      const catalog = readRepoFile("aisha/db/sql/tables/ai_cost_class_catalog.sql");
      expect(catalog).toContain("ai_cost_class_catalog_class_check");
      expect(catalog).toContain("ai_cost_class_catalog_band_order");
      expect(catalog).toContain("usd_p90 >= usd_p50");

      const policies = readRepoFile("aisha/db/sql/tables/ai_spend_policies.sql");
      expect(policies).toContain("ai_spend_policies_scope_check");
      expect(policies).toContain("ai_spend_policies_threshold_order");
      // global scope ⇔ scope_id NULL is what makes the wildcard rows safe
      expect(policies).toContain("(scope_type = 'global') = (scope_id IS NULL)");
      // one row per (scope, kind) — NULLS NOT DISTINCT covers the wildcards
      expect(policies).toContain("UNIQUE NULLS NOT DISTINCT (scope_type, scope_id, task_kind)");
    });

    it("authorizer + estimator RPCs follow the platform security pattern", () => {
      for (const fn of [
        "fn_estimate_task_cost",
        "fn_authorize_task_spend",
        "approve_task_spend_audited",
        "reject_task_spend_audited",
        "list_pending_spend_approvals",
        "set_ai_spend_policy_audited",
        "list_ai_spend_policies",
      ]) {
        const src = readRepoFile(`aisha/db/sql/functions/${fn}.sql`);
        expect(src, `${fn} missing SECURITY DEFINER`).toContain("SECURITY DEFINER");
        expect(src, `${fn} missing search_path`).toContain("SET search_path TO 'public'");
        expect(src, `${fn} missing REVOKE`).toContain("REVOKE ALL ON FUNCTION");
        expect(src, `${fn} missing GRANT`).toContain("GRANT EXECUTE");
      }
    });

    it("audited decision RPCs write the audit journal and gate on admin/staff", () => {
      for (const fn of [
        "approve_task_spend_audited",
        "reject_task_spend_audited",
        "set_ai_spend_policy_audited",
      ]) {
        const src = readRepoFile(`aisha/db/sql/functions/${fn}.sql`);
        expect(src, `${fn} missing admin guard`).toContain("is_admin_or_staff()");
        expect(src, `${fn} missing audit write`).toContain("INSERT INTO public.audit_journal");
      }
    });
  });

  describe("Admission integration — the authorizer is actually called", () => {
    it.each([
      "fn_create_workflow_run",
      "create_ai_run",
      "enqueue_agent_run",
    ])("%s calls fn_authorize_task_spend", (fn) => {
      const src = readRepoFile(`aisha/db/sql/functions/${fn}.sql`);
      expect(src).toContain("fn_authorize_task_spend(");
    });

    it("fn_create_workflow_run maps ask/deny to blocked + awaiting metadata", () => {
      const src = readRepoFile("aisha/db/sql/functions/fn_create_workflow_run.sql");
      expect(src).toContain("'spend_approval'");
      expect(src).toContain("'spend_denied'");
      expect(src).toContain("'spend_authorization', v_authz");
    });

    it("list_pending_spend_approvals reads the same metadata contract", () => {
      const src = readRepoFile("aisha/db/sql/functions/list_pending_spend_approvals.sql");
      expect(src).toContain("ar.metadata->>'awaiting' = 'spend_approval'");
      expect(src).toContain("'spend_authorization'");
    });

    it("reflection runner refuses blocked runs (regression: blocked runs used to execute)", () => {
      const src = readRepoFile("services/svc-ai-chat/src/reflection/orchestrator.ts");
      expect(src).toMatch(/if \(run\.status === 'blocked'\) \{\s*\n\s*return run;/);
    });

    it("orchestrationBridge notifies the approval gate instead of starting blocked runs", () => {
      const src = readRepoFile("services/svc-ai-chat/src/lib/orchestrationBridge.ts");
      expect(src).toContain("notifySpendApprovalGate");
      expect(src).toContain('"task_spend"');
      expect(src).toContain("/webhook/approval-gate");
    });
  });

  describe("Risk + catalog coherence", () => {
    it("fn_evaluate_proposal_risk understands the task_spend category", () => {
      const src = readRepoFile("aisha/db/sql/functions/fn_evaluate_proposal_risk.sql");
      expect(src).toContain("p_category = 'task_spend'");
      expect(src).toContain("estimate");
    });

    it("catalog seed bands are coherent (p50 <= p90, known classes)", () => {
      const seed = readRepoFile("aisha/db/seed/core/29_ai_cost_class_catalog.sql");
      const rows = [...seed.matchAll(
        /\('([a-z_-]+)',\s*'(micro|small|medium|large|xl)',\s*([\d.]+),\s*([\d.]+),/g,
      )];
      expect(rows.length, "no catalog rows parsed from seed").toBeGreaterThanOrEqual(15);
      for (const [, kind, , p50, p90] of rows) {
        expect(
          Number(p50) <= Number(p90),
          `catalog band inverted for ${kind}: p50 ${p50} > p90 ${p90}`,
        ).toBe(true);
      }
      // Core run kinds must stay covered — removing a band silently degrades
      // the zero-config posture for that kind to 'ask on no_estimate'.
      for (const kind of ["chat", "project_delivery", "ide_session", "reflection"]) {
        expect(seed, `catalog seed missing kind '${kind}'`).toContain(`('${kind}'`);
      }
    });

    it("compiled seed ships the catalog (cold-start regression guard)", () => {
      const compiled = readRepoFile("aisha/db/seed.compiled.sql");
      expect(
        compiled.includes("ai_cost_class_catalog"),
        "seed.compiled.sql missing ai_cost_class_catalog — run AISHA_SEED_PROFILE=demo npm run db:seed:compile",
      ).toBe(true);
    });
  });
});
