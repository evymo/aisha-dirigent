/**
 * Gate: PR1 — ai_resolver_policy operator-tunable substrate (#35).
 *
 * Locks the SoT for the operator-control program's foundation: the orchestration-decision
 * weights/thresholds (previously 100% hardcoded literals in aisha_resolve_clow_backend) now
 * have an operator-tunable table + an always-present GLOBAL default row holding TODAY'S exact
 * literals. This PR is SUBSTRATE-ONLY — it must not change resolver behaviour (the resolver is
 * wired to read the table in the follow-up PR, guarded by the #18 decision matrix proving
 * byte-identical output when policy == seed). Runtime + constraints: pgTAP schema/13.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const TABLE = read('aisha/db/sql/tables/ai_resolver_policy.sql');
const SEED = read('aisha/db/seed/core/37_ai_resolver_policy.sql');
const HEALS = read('aisha/db/heals.sql');
const PGTAP = read('aisha/db/tests/schema/13_ai_resolver_policy.sql');
const RESOLVER = read('aisha/db/sql/functions/aisha_resolve_clow_backend.sql');
const SET_RPC = read('aisha/db/sql/functions/set_ai_resolver_policy_audited.sql');
const LIST_RPC = read('aisha/db/sql/functions/list_ai_resolver_policies.sql');
const PGTAP_RPC = read('aisha/db/tests/schema/14_ai_resolver_policy_rpcs.sql');

const TUNABLE_COLUMNS = [
  'bench_weight', 'local_bonus', 'cost_match_weight', 'tool_match_weight', 'vision_match_weight',
  'budget_remaining_floor', 'budget_max_cost', 'premium_max_cost',
  'batch_min_deadline_hours', 'batch_min_tokens', 'health_allow_set',
  'default_bench', 'default_expected_tokens', 'default_deadline_hours',
  'default_max_cost', 'default_budget_remaining',
];

describe('#35 PR1 — ai_resolver_policy operator-tunable substrate', () => {
  it('table SoT: scope×task shape, every tunable column, scope-reserved seam, fail-closed CHECKs', () => {
    expect(TABLE).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_resolver_policy/);
    expect(TABLE).toMatch(/scope_type\s+text\s+NOT NULL DEFAULT 'global'/);
    expect(TABLE).toMatch(/task_kind\s+text/);
    for (const col of TUNABLE_COLUMNS) {
      expect(TABLE, `tunable column ${col} must exist`).toContain(col);
    }
    // forward-seam declared for the scope-type-write-read-parity gate (story/instance not yet read).
    expect(TABLE).toMatch(/@scope-reserved:\s*story,\s*instance/);
    // fail-closed: non-negative weights, ordered cost cutoffs, non-empty health set.
    expect(TABLE).toMatch(/ai_resolver_policy_weights_nonneg/);
    expect(TABLE).toMatch(/ai_resolver_policy_cost_order/);
    expect(TABLE).toMatch(/ai_resolver_policy_health_nonempty/);
    expect(TABLE).toMatch(/UNIQUE NULLS NOT DISTINCT \(scope_type, scope_id, task_kind\)/);
  });

  it('seed: one GLOBAL row carries today\'s exact resolver literals (byte-identical contract)', () => {
    expect(SEED).toMatch(/INSERT INTO public\.ai_resolver_policy/);
    expect(SEED).toMatch(/'global', NULL, NULL,\s*\n?\s*0\.55, 0\.20, 0\.15, 0\.05, 0\.05/);
    expect(SEED).toMatch(/1\.00, 0\.50, 5\.00/);
    expect(SEED).toMatch(/24, 50000, ARRAY\['healthy','unknown'\]/);
    expect(SEED).toMatch(/ON CONFLICT ON CONSTRAINT ai_resolver_policy_scope_kind_uniq DO NOTHING/);
  });

  it('heals reconciles the table + seeds the global row for existing DBs (resolver fails loud on absence)', () => {
    expect(HEALS).toMatch(/\\ir sql\/tables\/ai_resolver_policy\.sql/);
    expect(HEALS).toMatch(/\\ir sql\/rls\/ai_resolver_policy\.sql/);
    expect(HEALS).toMatch(/\\ir sql\/indexes\/idx_ai_resolver_policy_lookup\.sql/);
    expect(HEALS).toMatch(/\\ir sql\/triggers\/ai_resolver_policy_updated_at\.sql/);
    expect(HEALS).toMatch(/INSERT INTO public\.ai_resolver_policy[\s\S]*?'global', NULL, NULL, 0\.55, 0\.20, 0\.15/);
  });

  it('pgTAP locks the literals + the fail-closed constraints', () => {
    expect(PGTAP).toMatch(/SELECT plan\(12\)/);
    expect(PGTAP).toMatch(/bench_weight = 0\.55/);
    expect(PGTAP).toMatch(/health_allow_set = \{healthy,unknown\}/);
    expect(PGTAP).toMatch(/cost_order/);
  });

  it('the resolver READS the global policy (fail-loud on absence) and drops every hardcoded literal', () => {
    expect(RESOLVER).toMatch(/FROM\s+public\.ai_resolver_policy/);
    expect(RESOLVER).toMatch(/scope_type = 'global'/);
    // fail-loud: a missing global row raises, never a silent re-baked literal.
    expect(RESOLVER).toMatch(/has no active GLOBAL row/);
    // scoring weights + thresholds + defaults are policy-driven now.
    expect(RESOLVER).toMatch(/COALESCE\(b\.overall_score, v_pol\.default_bench\) \* v_pol\.bench_weight/);
    expect(RESOLVER).toMatch(/v_pol\.budget_max_cost/);
    expect(RESOLVER).toMatch(/p\.last_health_status = ANY\(v_pol\.health_allow_set\)/);
    // the active policy is exposed in the decision output (the lens persisted downstream).
    expect(RESOLVER).toMatch(/'policy', jsonb_build_object/);
    // the old hardcoded literals are GONE.
    expect(RESOLVER).not.toMatch(/overall_score, 0\.5\) \* 0\.55/);
    expect(RESOLVER).not.toMatch(/v_max_cost < 0\.50 THEN 'budget'/);
  });

  it('audited write/read RPCs: admin-guarded, JIT-provisioned, inherit-on-NULL, audited, least-privilege', () => {
    // both RPCs guard on is_admin_or_staff (clone of the spend-policy governance).
    expect(SET_RPC).toMatch(/is_admin_or_staff\(\)/);
    expect(LIST_RPC).toMatch(/is_admin_or_staff\(\)/);
    expect(SET_RPC).toMatch(/ensure_current_user\(\)/);
    // INHERIT: a NULL param keeps the base value (never silently zeroes a weight).
    expect(SET_RPC).toMatch(/COALESCE\(p_bench_weight, v_base\.bench_weight\)/);
    // audited under a distinct action.
    expect(SET_RPC).toMatch(/'ai\.resolver_policy\.set'/);
    // least privilege: REVOKE PUBLIC then grant authenticated + service_role.
    expect(SET_RPC).toMatch(/REVOKE ALL ON FUNCTION public\.set_ai_resolver_policy_audited/);
    expect(LIST_RPC).toMatch(/REVOKE ALL ON FUNCTION public\.list_ai_resolver_policies/);
    // heals re-applies the resolver + both RPCs so existing DBs pick them up (no baseline reset).
    expect(HEALS).toMatch(/\\ir sql\/functions\/aisha_resolve_clow_backend\.sql/);
    expect(HEALS).toMatch(/\\ir sql\/functions\/set_ai_resolver_policy_audited\.sql/);
    expect(HEALS).toMatch(/\\ir sql\/functions\/list_ai_resolver_policies\.sql/);
    // pgTAP proves guard + upsert + inherit + audit.
    expect(PGTAP_RPC).toMatch(/SELECT plan\(9\)/);
    expect(PGTAP_RPC).toMatch(/denies a non-admin caller/);
    expect(PGTAP_RPC).toMatch(/inherits, never zeroes/);
  });
});
