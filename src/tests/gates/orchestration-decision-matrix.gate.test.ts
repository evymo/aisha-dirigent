/**
 * Gate: PH1 — Orchestration-Decision matrix harness (#18).
 *
 * The master plan's #1 finalization proof: aisha_resolve_clow_backend DYNAMICALLY picks
 * model + executor across ALL serviceable providers — nothing hardcoded. This gate locks the
 * SoT for the two-layer harness:
 *   - aisha/db/tests/schema/12_orchestration_decision_matrix.sql — runtime pgTAP, deterministic
 *     (synthetic providers), proving the decision axes: serviceable dynamism, residency,
 *     embedding-capability gate, cost-class match, tools filter, no-substitution, transparency.
 *   - src/tests/omni-acceptance/orchestration-acceptance/decision-matrix.omni.spec.ts — the LIVE
 *     integration suite (real discovered providers), self-skipping unless OMNI_ACCEPTANCE + a DB.
 * Together they prove the decision logic both deterministically AND against a real dev backend.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const PGTAP = read('aisha/db/tests/schema/12_orchestration_decision_matrix.sql');
const LIVE = read('src/tests/omni-acceptance/orchestration-acceptance/decision-matrix.omni.spec.ts');
const RESOLVER = read('aisha/db/sql/functions/aisha_resolve_clow_backend.sql');

describe('#18 PH1 — orchestration-decision matrix harness', () => {
  it('the runtime pgTAP exists and covers the decision axes', () => {
    expect(PGTAP).toMatch(/SELECT plan\(10\)/);
    // policy-driven proofs (operator-control): the resolver reads ai_resolver_policy + fail-loud.
    expect(PGTAP).toMatch(/policy is read \+ tunable/);
    expect(PGTAP).toMatch(/fail-loud, no fallback/);
    // the central dynamism proof: same task, different serviceable → different winner.
    expect(PGTAP).toMatch(/DIFFERENT winner \(dynamic\)/);
    // residency hard-filter + capability gate + cost-class match + tools filter.
    expect(PGTAP).toMatch(/cloud_forbidden.*only local/i);
    expect(PGTAP).toMatch(/task_kind=embedding resolves to the embedding model/);
    expect(PGTAP).toMatch(/premium cost-class match wins/);
    expect(PGTAP).toMatch(/needs_tools.*function-calling/i);
    // no-substitution (fail loud) + transparency.
    expect(PGTAP).toMatch(/resolved=false \(no substitution\)/);
    expect(PGTAP).toMatch(/transparent \(reasoning \+ scored candidates\)/);
    // drives the real resolver, not a copy.
    expect(PGTAP).toMatch(/aisha_resolve_clow_backend\(/);
  });

  it('the live integration suite exists, is CI-isolated, and proves dynamism + no-fallback', () => {
    // self-skips unless OMNI_ACCEPTANCE is set AND a DB URL is present (never reddens normal CI).
    expect(LIVE).toMatch(/const ACCEPTANCE = Boolean\(process\.env\.OMNI_ACCEPTANCE\)/);
    expect(LIVE).toMatch(/const d = ACCEPTANCE \? describe : describe\.skip/);
    expect(LIVE).toMatch(/AISHA_DB_URL \|\| process\.env\.DATABASE_URL/);
    // resolver auth: SET ROLE service_role on a dedicated client, then RESET.
    expect(LIVE).toMatch(/SET ROLE service_role/);
    expect(LIVE).toMatch(/RESET ROLE/);
    // the live proofs: dynamism, no-substitution (fail loud), transparency.
    expect(LIVE).toMatch(/winner tracks the serviceable set \(dynamic\)/);
    expect(LIVE).toMatch(/resolved=false \(no hardcoded fallback\)/);
    expect(LIVE).toMatch(/skip-with-log/i);
  });

  it('the resolver SoT still exposes the axes the matrix asserts (no drift)', () => {
    // serviceable filter + residency hard-filter + embedding-capability gate + cost-class + score.
    expect(RESOLVER).toMatch(/cardinality\(v_serviceable\) = 0 OR p\.slug = ANY\(v_serviceable\)/);
    expect(RESOLVER).toMatch(/NOT v_cloud_forbidden OR p\.backend_kind IN \('local_ollama', ?'local_vllm'\)/);
    expect(RESOLVER).toMatch(/v_task_kind <> 'embedding' OR r\.is_embedding/);
    expect(RESOLVER).toMatch(/p\.cost_class = v_cost_class_filter/);
    expect(RESOLVER).toMatch(/'reasoning', v_reasoning/);
  });
});
