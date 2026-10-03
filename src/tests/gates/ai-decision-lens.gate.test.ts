/**
 * Gate: PR4 — decision lens persistence (#38).
 *
 * The resolver already emits a per-candidate score breakdown + the active policy on every decision;
 * fn_record_execution_decision now NORMALIZES that blob into queryable rows so the admin can see
 * WHY a model won + which weights were live — without hand-parsing decision_json.
 *   - ai_decision_candidates (one row per candidate, FK-owned by ai_decisions, ON DELETE CASCADE);
 *   - ai_decisions.resolver_policy_id (which ai_resolver_policy row produced the decision);
 *   - the TS decision threads inputs.policy so resolver_policy_id is real in prod.
 * Runtime proof: aisha/db/tests/schema/15_ai_decision_lens.sql.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const TABLE = read('aisha/db/sql/tables/ai_decision_candidates.sql');
const DECISIONS = read('aisha/db/sql/tables/ai_decisions.sql');
const RLS = read('aisha/db/sql/rls/ai_decision_candidates.sql');
const FN = read('aisha/db/sql/functions/fn_record_execution_decision.sql');
const DECISION_TS = read('services/svc-ai-chat/src/reflection/decision.ts');
const OPENCLAW_TS = read('services/svc-ai-chat/src/reflection/nodes/openclaw_resolve_clow.ts');
const HEALS = read('aisha/db/heals.sql');
const PGTAP = read('aisha/db/tests/schema/15_ai_decision_lens.sql');
const ADMIN_RPC = read('aisha/db/sql/functions/get_ai_decisions_admin.sql');

describe('#38 PR4 — decision lens persistence', () => {
  it('ai_decision_candidates (FK-owned child) + resolver_policy_id column + RLS chain', () => {
    expect(TABLE).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_decision_candidates/);
    expect(TABLE).toMatch(/decision_id\s+uuid\s+NOT NULL REFERENCES public\.ai_decisions\(id\) ON DELETE CASCADE/);
    for (const col of ['rank', 'is_top', 'score', 'reason', 'provider_slug', 'model_id']) {
      expect(TABLE, `column ${col}`).toContain(col);
    }
    // soft journal pointer on the parent (no FK; a snapshot — distinct from the owned child).
    expect(DECISIONS).toMatch(/resolver_policy_id uuid/);
    // RLS: admin reads all; participants chain through the parent decision.
    expect(RLS).toMatch(/is_admin_or_staff\(\)/);
    expect(RLS).toMatch(/participant_read_ai_decision_candidates/);
    expect(RLS).toMatch(/FROM public\.ai_decisions d\s+WHERE d\.id = ai_decision_candidates\.decision_id/);
  });

  it('the journal writer normalizes the candidate ranking + stamps the active policy', () => {
    expect(FN).toMatch(/resolver_policy_id/);
    expect(FN).toMatch(/INSERT INTO public\.ai_decision_candidates/);
    // graceful explode (array-guarded) of the resolver's candidates.
    expect(FN).toMatch(/jsonb_typeof\(p_decision->'candidates'\) = 'array'/);
    expect(FN).toMatch(/row_number\(\) OVER \(ORDER BY \(c->>'score'\)::numeric DESC/);
    expect(FN).toMatch(/p_decision->'policy'->>'id'/);
  });

  it('the TS decision threads the active policy (so resolver_policy_id is real in prod)', () => {
    // the schema + ClowBackend accept policy; toExecutionDecision threads it; openclaw sources it.
    expect(DECISION_TS).toMatch(/policy: z\.unknown\(\)\.optional\(\)/);
    expect(DECISION_TS).toMatch(/policy: clow\?\.policy/);
    expect(OPENCLAW_TS).toMatch(/policy: \(resolution\?\.inputs as \{ policy\?: unknown \}/);
  });

  it('heals reconciles the lens for existing DBs (table + column + writer)', () => {
    expect(HEALS).toMatch(/\\ir sql\/tables\/ai_decision_candidates\.sql/);
    expect(HEALS).toMatch(/ADD COLUMN IF NOT EXISTS resolver_policy_id uuid/);
    expect(HEALS).toMatch(/\\ir sql\/functions\/fn_record_execution_decision\.sql/);
  });

  it('get_ai_decisions_admin exposes the lens (admin-guarded, candidates nested, est-vs-actual cost)', () => {
    expect(ADMIN_RPC).toMatch(/CREATE OR REPLACE FUNCTION public\.get_ai_decisions_admin/);
    expect(ADMIN_RPC).toMatch(/is_admin_or_staff\(\)/);
    expect(ADMIN_RPC).toMatch(/jsonb_agg\(jsonb_build_object/);                  // candidate ranking nested
    expect(ADMIN_RPC).toMatch(/SUM\(\(ate\.cost_json->>'usd'\)::numeric\)/);     // actual cost from trace
    expect(ADMIN_RPC).toMatch(/resolver_policy_id/);                            // which weights were live
    expect(HEALS).toMatch(/\\ir sql\/functions\/get_ai_decisions_admin\.sql/);
  });

  it('pgTAP proves normalization (ranking, is_top, breakdown) + graceful empty + admin read', () => {
    expect(PGTAP).toMatch(/SELECT plan\(8\)/);
    expect(PGTAP).toMatch(/normalized into rows/);
    expect(PGTAP).toMatch(/persists no candidate rows \(graceful\)/);
    expect(PGTAP).toMatch(/get_ai_decisions_admin denies a non-admin/);
    expect(PGTAP).toMatch(/returns the decision with its 2-candidate ranking/);
  });
});
