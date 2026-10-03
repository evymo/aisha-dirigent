/**
 * Gate: RBAC 4-clause unification — fn_get_run_citations + graph_nodes RLS.
 *
 * After workbench Phase 6+7 merged, the codebase had two divergent
 * story-scoped RBAC predicates:
 *   - Phase 6/7 + story_timeline: admin_or_staff OR is_stack_default OR participant
 *   - Step 2 (fn_get_run_citations) + Step 7.3 (fn_get_run_graph_context):
 *     admin_or_staff OR ps.user_id OR participant
 *
 * The 4-clause unification absorbed both Step 2/7 surfaces into the
 * 4-clause superset. That change is now part of canonical SoT (the
 * function lives in aisha/db/sql/functions/fn_get_run_citations.sql, the
 * policy in aisha/db/sql/policies/graph_nodes_admin_staff_read.sql) and is
 * compiled into the real baseline. This gate reads ONLY current SoT — the
 * compiled schema (00000000000000_baseline.sql) and the per-object SoT
 * files — never the archived migration. It locks the predicate so a future
 * drift gets caught.
 *
 * Static regex-on-source. No live DB needed.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
// The compiled schema (real baseline) is canonical SoT — it is NOT redirected
// by the archive shim. The function + policy this gate locks are emitted into
// it verbatim, so its body carries the same DDL the archived migration once did
// (CREATE OR REPLACE FUNCTION, DROP/CREATE POLICY, REVOKE/GRANT, 4-clause predicate).
const BASELINE     = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const SOT_FN       = resolve(ROOT, 'aisha/db/sql/functions/fn_get_run_citations.sql');
const SOT_POLICY   = resolve(ROOT, 'aisha/db/sql/policies/graph_nodes_admin_staff_read.sql');
const REGISTRY     = resolve(ROOT, 'aisha/db/migration-registry.json');

describe('RBAC 4-clause unification (fn_get_run_citations + graph_nodes RLS)', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // The 4-clause unification is absorbed into the compiled baseline (canonical
  // SoT). These assertions read that baseline — the same DDL the archived
  // migration once carried — and the real (baseline-only) registry.
  describe('Compiled schema (baseline)', () => {
    test('baseline exists + registry is baseline-only (migration absorbed)', () => {
      expect(existsSync(BASELINE)).toBe(true);
      // The real registry is baseline-only: no non-baseline migrations remain.
      // (The unification migration was absorbed into the baseline above.)
      expect(readFileSync(REGISTRY, 'utf-8')).toMatch(/Baseline-only state/i);
    });

    test('declares fn_get_run_citations via CREATE OR REPLACE (no signature change)', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_run_citations\(p_run_id uuid\)/);
      // Return signature unchanged from the existing definition.
      expect(sql).toMatch(/RETURNS TABLE \(\s*chunk_id\s+uuid/);
    });

    test('SECURITY DEFINER + search_path + STABLE preserved', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      const fnSection = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_run_citations/)[1]
        ?.split(/DROP POLICY/)[0] ?? '';
      expect(fnSection).toMatch(/SECURITY DEFINER/);
      expect(fnSection).toMatch(/SET search_path TO 'public'/);
      expect(fnSection).toMatch(/STABLE/);
    });

    test('REVOKE + explicit GRANT preserved (authenticated + service_role)', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_get_run_citations\(uuid\) FROM PUBLIC/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_citations\(uuid\) TO authenticated/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_citations\(uuid\) TO service_role/);
    });

    test('fn_get_run_citations: predicate has all 4 clauses', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      const fnSection = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_run_citations/)[1]
        ?.split(/DROP POLICY/)[0] ?? '';
      expect(fnSection).toMatch(/public\.is_admin_or_staff\(auth\.uid\(\)\)/);
      expect(fnSection).toMatch(/ps\.is_stack_default\s*=\s*true/);
      expect(fnSection).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(fnSection).toMatch(/public\.story_participants sp[\s\S]*sp\.user_id\s*=\s*auth\.uid\(\)/);
    });

    test('graph_nodes admin staff read: DROP + CREATE POLICY with all 4 clauses', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      expect(sql).toMatch(/DROP POLICY IF EXISTS "graph_nodes admin staff read" ON public\.graph_nodes/);
      expect(sql).toMatch(/CREATE POLICY "graph_nodes admin staff read" ON public\.graph_nodes/);
      const policySection = sql.split(/CREATE POLICY "graph_nodes admin staff read"/)[1] ?? '';
      // Měří se PŘÍTOMNOST klauzule nároku, ne její pravopis. Od 2026-09-12 je
      // predikát obalený do poddotazu — `(SELECT public.is_admin_or_staff((SELECT
      // auth.uid())))` — aby se vyhodnotil JEDNOU za dotaz, ne pro každý řádek
      // (10 405 ms × 27 ms nad 43 157 řádky, viz rls-predikat-a-indexy). Nárok
      // se tím nemění, mizí jen opakování; vzor proto musí snést obě podoby.
      expect(policySection).toMatch(/public\.is_admin_or_staff\(\s*\(?\s*(SELECT\s+)?auth\.uid\(\)/i);
      expect(policySection).toMatch(/ps\.is_stack_default\s*=\s*true/);
      expect(policySection).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(policySection).toMatch(/public\.story_participants sp[\s\S]*sp\.user_id\s*=\s*auth\.uid\(\)/);
    });

    test('no `owner_user_id` in either object body (regression guard for PR #111 fix)', () => {
      const sql = readFileSync(BASELINE, 'utf-8');
      // Isolate just the fn_get_run_citations function body + the graph_nodes
      // policy body so unrelated baseline objects can't false-positive.
      const fnBody = sql
        .split(/CREATE OR REPLACE FUNCTION public\.fn_get_run_citations/)[1]
        ?.match(/AS\s*\$\$[\s\S]*?\$\$/)?.[0] ?? '';
      const policyBody = sql
        .split(/CREATE POLICY "graph_nodes admin staff read"/)[1]
        ?.split(/;/)[0] ?? '';
      expect(fnBody).not.toMatch(/owner_user_id/);
      expect(policyBody).not.toMatch(/owner_user_id/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('SoT mirrors agree with the migration', () => {
    test('fn_get_run_citations SoT has all 4 clauses', () => {
      const sot = readFileSync(SOT_FN, 'utf-8');
      const fnBody = sot.match(/AS\s*\$\$[\s\S]*?\$\$/g)?.join('\n') ?? '';
      expect(fnBody).toMatch(/public\.is_admin_or_staff\(auth\.uid\(\)\)/);
      expect(fnBody).toMatch(/ps\.is_stack_default\s*=\s*true/);
      expect(fnBody).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(fnBody).toMatch(/sp\.user_id\s*=\s*auth\.uid\(\)/);
      expect(fnBody).not.toMatch(/owner_user_id/);
    });

    test('SoT documents the patch (so future readers know the history)', () => {
      const sot = readFileSync(SOT_FN, 'utf-8');
      expect(sot).toMatch(/20260520060000_rbac_4clause_unification/);
    });

    test('graph_nodes_admin_staff_read SoT has all 4 clauses', () => {
      const sot = readFileSync(SOT_POLICY, 'utf-8');
      // Viz výše: přítomnost klauzule, ne pravopis (predikát je v poddotazu).
      expect(sot).toMatch(/public\.is_admin_or_staff\(\s*\(?\s*(SELECT\s+)?auth\.uid\(\)/i);
      expect(sot).toMatch(/ps\.is_stack_default\s*=\s*true/);
      expect(sot).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(sot).toMatch(/sp\.user_id\s*=\s*auth\.uid\(\)/);
      // Documentary comments may still mention the historical typo. Only
      // check the SQL body (CREATE POLICY ... );).
      const policyBody = sot.split(/CREATE POLICY/)[1] ?? '';
      expect(policyBody).not.toMatch(/owner_user_id/);
    });

    test('graph_nodes RLS policy SoT documents the patch', () => {
      const sot = readFileSync(SOT_POLICY, 'utf-8');
      expect(sot).toMatch(/20260520060000_rbac_4clause_unification/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Behaviour change is strictly broadening (no clauses removed)', () => {
    test('all pre-existing clauses survive (admin_or_staff, ps.user_id, story_participants)', () => {
      // The unification is additive — it adds is_stack_default. The other
      // three clauses must still be present in both surfaces.
      const sotFn     = readFileSync(SOT_FN, 'utf-8');
      const sotPolicy = readFileSync(SOT_POLICY, 'utf-8');
      for (const src of [sotFn, sotPolicy]) {
        expect(src).toMatch(/public\.is_admin_or_staff/);
        expect(src).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
        expect(src).toMatch(/story_participants/);
      }
    });
  });
});
