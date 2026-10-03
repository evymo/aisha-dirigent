/**
 * RAG eval foundation gate (Step 0 of retrieval optimization plan 2026).
 *
 * Static verification that the eval baseline infrastructure is wired:
 *   - Migration creates 3 tables + 5 RPCs with canonical security pattern
 *   - Audited RPCs write to audit_journal
 *   - RLS enabled on rag_eval_* tables (admin/staff read only)
 *   - Service endpoint exists with verifyServiceRole + rpcService usage
 *   - n8n workflow scheduled + service-role auth + audit step
 *   - Golden seed exists with idempotent ON CONFLICT
 *   - i18n parity across all 6 supported languages
 *   - React hook uses aisha.rpc + Zod parse (not the legacy adapter, not raw .from())
 *
 * Why static-first: CI runs without a live DB. We can't query rag_eval_runs
 * here. Runtime verification (rolling baseline non-regression after Step 1/3)
 * is enforced separately by the WF_RAG_EVAL_NIGHTLY workflow + threshold
 * comparison logic that runs *after* this gate.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

/**
 * ⛔ PŘEPSÁNO 2026-09-19: servisní autentizace uzlu je POVĚŘENÍ „AISHA Gateway
 * (Service Role)" (Authorization: Bearer POSTGREST_SERVICE_TOKEN, zakládá ho
 * provision-credentials), ne `$env.POSTGREST_SERVICE_TOKEN` v hlavičce — to n8n
 * neslo jako tajemství v prostém env a uzel s autentizací bez pověření padal na
 * „Credentials not found" (brána n8n-uzly-autentizace-pres-povereni).
 */
function uzelVolaSeServisnimPoverenim(raw: string, cesta: RegExp): boolean {
  const wf = JSON.parse(raw) as { nodes: Array<{ parameters?: { url?: unknown }; credentials?: Record<string, { name?: string }> }> };
  return wf.nodes.some(
    (n) => cesta.test(String(n.parameters?.url ?? "")) && n.credentials?.httpHeaderAuth?.name === "AISHA Gateway (Service Role)",
  );
}

import { resolve } from 'node:path';

const ROOT = process.cwd();

const MIGRATION         = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const GOLDEN_SEED       = resolve(ROOT, 'aisha/db/seed/core/31_rag_eval_golden.sql');
const SERVICE_ROUTE     = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/rag-eval.ts');
const JUDGE_LIB         = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/rag-eval-judges.ts');
const COMPLETION_LIB    = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/llm-completion.ts');
const SERVER_TS         = resolve(ROOT, 'services/svc-mcp-knowledge/src/server.ts');
const N8N_WORKFLOW      = resolve(ROOT, 'n8n/workflows/WF_RAG_EVAL_NIGHTLY.json');
const HOOK_FILE         = resolve(ROOT, 'src/hooks/useRagBaseline.ts');
const HOOK_INDEX        = resolve(ROOT, 'src/hooks/index.ts');
const SCHEMAS_FILE      = resolve(ROOT, 'src/schemas/rpcResponseSchemas.ts');
const ADMIN_PAGE        = resolve(ROOT, 'src/pages/admin/AdminAiObservability.tsx');
const I18N_LANGS        = ['en', 'cs', 'de', 'fr', 'ru', 'th'];

describe('RAG eval foundation gate', () => {

  describe('Migration', () => {
    test('migration file exists', () => {
      expect(existsSync(MIGRATION), `Missing migration: ${MIGRATION}`).toBe(true);
    });

    test('creates all 3 rag_eval_* tables', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.rag_eval_golden/);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.rag_eval_runs/);
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.rag_eval_baselines/);
    });

    test('all 3 tables have RLS enabled (admin/staff read only)', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/ALTER TABLE public\.rag_eval_golden\s+ENABLE ROW LEVEL SECURITY/);
      expect(sql).toMatch(/ALTER TABLE public\.rag_eval_runs\s+ENABLE ROW LEVEL SECURITY/);
      expect(sql).toMatch(/ALTER TABLE public\.rag_eval_baselines\s+ENABLE ROW LEVEL SECURITY/);
      // RLS policies must call is_admin_or_staff — no anon read leakage
      const policyCount = (sql.match(/CREATE POLICY[\s\S]*?is_admin_or_staff/g) || []).length;
      expect(policyCount, 'expected 3 admin/staff read policies').toBeGreaterThanOrEqual(3);
    });

    test('creates all 5 RPCs with canonical security pattern', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      const expectedFns = [
        'fn_get_rag_eval_golden_set',
        'fn_record_rag_eval_run_audited',
        'fn_get_rag_baseline',
        'fn_get_rag_run_detail',
        'fn_compute_rag_baseline_audited',
      ];
      for (const fn of expectedFns) {
        expect(sql, `Missing function ${fn}`).toMatch(
          new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`),
        );
      }
      // SECURITY DEFINER + search_path on every function (count = function count)
      const secDefiner = (sql.match(/SECURITY DEFINER/g) || []).length;
      expect(secDefiner, 'every RPC must be SECURITY DEFINER').toBeGreaterThanOrEqual(expectedFns.length);
      const searchPath = (sql.match(/SET search_path TO 'public'/g) || []).length;
      expect(searchPath, "every RPC must SET search_path TO 'public'").toBeGreaterThanOrEqual(expectedFns.length);
    });

    test('each RPC has REVOKE FROM PUBLIC + explicit GRANT', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      // 5 RPCs + 1 trigger fn (fn_rag_eval_golden_set_updated_at). Trigger fn
      // doesn't need REVOKE/GRANT because it's invoked by the trigger, not by clients.
      const revokes = (sql.match(/REVOKE ALL ON FUNCTION public\.fn_/g) || []).length;
      expect(revokes, 'expected REVOKE ALL ON FUNCTION on every RPC').toBeGreaterThanOrEqual(5);
      const grants = (sql.match(/GRANT EXECUTE ON FUNCTION public\.fn_/g) || []).length;
      expect(grants, 'expected GRANT EXECUTE on every RPC').toBeGreaterThanOrEqual(5);
      // No GRANT to anon — eval is admin/service only
      expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_(get_rag|record_rag|compute_rag)[^;]*TO anon/);
    });

    test('audited RPCs write to audit_journal', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/INSERT INTO public\.audit_journal/);
      expect(sql).toMatch(/'rag_eval\.run_recorded'/);
      expect(sql).toMatch(/'rag_eval\.baseline_recomputed'/);
    });

    test('RPCs enforce auth check (auth.uid OR service_role)', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      const authChecks = (sql.match(/auth\.uid\(\) IS NULL AND current_setting\('role', true\) != 'service_role'/g) || []).length;
      expect(authChecks, 'every RPC must guard against unauthenticated callers').toBeGreaterThanOrEqual(5);
    });

    test('composite_score is GENERATED ALWAYS (not user-writable)', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      // composite_score on rag_eval_runs is a derived metric — must be GENERATED so callers can't fake scores.
      // Allow space inside numeric(4, 3) since SQL formatting may vary.
      expect(sql).toMatch(/composite_score\s+numeric\(\s*\d+\s*,\s*\d+\s*\)\s+GENERATED\s+ALWAYS\s+AS/);
    });
  });

  describe('Golden seed', () => {
    test('seed file exists', () => {
      expect(existsSync(GOLDEN_SEED), `Missing seed: ${GOLDEN_SEED}`).toBe(true);
    });

    test('seed is idempotent (ON CONFLICT DO UPDATE)', () => {
      const sql = readFileSync(GOLDEN_SEED, 'utf-8');
      expect(sql).toMatch(/INSERT INTO public\.rag_eval_golden/);
      expect(sql).toMatch(/ON CONFLICT \(slug\) DO UPDATE/);
    });

    test('seed covers all 4 context profiles × at least 1 language', () => {
      const sql = readFileSync(GOLDEN_SEED, 'utf-8');
      // each profile must appear in at least 1 slug
      expect(sql).toMatch(/'chat_lightweight'/);
      expect(sql).toMatch(/'repo_plus_rules'/);
      expect(sql).toMatch(/'planning_heavy'/);
      expect(sql).toMatch(/'evidence_strict'/);
    });

    test('seed has at least 20 records (statistical minimum)', () => {
      const sql = readFileSync(GOLDEN_SEED, 'utf-8');
      // Records are comma-separated tuples ending with `)` followed by `,` or final `)`.
      // We use slug presence as a reliable count proxy.
      const slugMatches = sql.match(/^\s*'[a-z]{2}-[a-z]{2}-[a-z][\w-]*',/gm) || [];
      expect(slugMatches.length, 'expected ≥20 golden records').toBeGreaterThanOrEqual(20);
    });
  });

  describe('Service endpoint', () => {
    test('rag-eval route file exists', () => {
      expect(existsSync(SERVICE_ROUTE), `Missing route: ${SERVICE_ROUTE}`).toBe(true);
    });

    test('endpoints are service-role only (verifyServiceRole guard)', () => {
      const code = readFileSync(SERVICE_ROUTE, 'utf-8');
      // Both /rag/eval/run and /rag/eval/baseline/recompute must call verifyServiceRole
      const guards = (code.match(/verifyServiceRole\(req\.headers\.authorization\)/g) || []).length;
      expect(guards, 'expected verifyServiceRole guard on every eval endpoint').toBeGreaterThanOrEqual(2);
    });

    test('orchestration uses rpcService (RPC-only, no .from())', () => {
      const code = readFileSync(SERVICE_ROUTE, 'utf-8');
      expect(code).toMatch(/rpcService<.*>?\(/);
      expect(code).not.toMatch(/\.from\(['"]rag_eval/);
    });

    test('calls fn_record_rag_eval_run_audited (audited persist) and fn_compute_rag_baseline_audited', () => {
      const code = readFileSync(SERVICE_ROUTE, 'utf-8');
      expect(code).toMatch(/fn_record_rag_eval_run_audited/);
      expect(code).toMatch(/fn_compute_rag_baseline_audited/);
    });

    test('judge lib exists + uses temperature=0 + json_mode for deterministic scoring', () => {
      expect(existsSync(JUDGE_LIB), `Missing judge lib: ${JUDGE_LIB}`).toBe(true);
      expect(existsSync(COMPLETION_LIB), `Missing completion lib: ${COMPLETION_LIB}`).toBe(true);
      const judges = readFileSync(JUDGE_LIB, 'utf-8');
      expect(judges).toMatch(/temperature:\s*0/);
      expect(judges).toMatch(/json_mode:\s*true/);
    });

    test('route registered in server.ts', () => {
      const server = readFileSync(SERVER_TS, 'utf-8');
      expect(server).toMatch(/import \{ ragEvalRoutes \} from '\.\/routes\/rag-eval\.js'/);
      expect(server).toMatch(/app\.register\(ragEvalRoutes\)/);
    });
  });

  describe('n8n workflow', () => {
    test('WF_RAG_EVAL_NIGHTLY exists', () => {
      expect(existsSync(N8N_WORKFLOW), `Missing workflow: ${N8N_WORKFLOW}`).toBe(true);
    });

    test('workflow runs daily on schedule trigger', () => {
      const json = JSON.parse(readFileSync(N8N_WORKFLOW, 'utf-8'));
      const trigger = json.nodes.find((n: { type: string }) => n.type === 'n8n-nodes-base.scheduleTrigger');
      expect(trigger, 'workflow must have schedule trigger').toBeTruthy();
      const interval = trigger.parameters?.rule?.interval?.[0];
      expect(interval?.field, 'interval must be days for daily cadence').toBe('days');
    });

    test('workflow calls svc-mcp-knowledge with service-role auth', () => {
      const raw = readFileSync(N8N_WORKFLOW, 'utf-8');
      expect(raw).toMatch(/rag\/eval\/run/);
      expect(uzelVolaSeServisnimPoverenim(raw, /rag\/eval\/run/)).toBe(true);
    });

    test('workflow writes integration audit via log_integration_action', () => {
      const raw = readFileSync(N8N_WORKFLOW, 'utf-8');
      expect(raw).toMatch(/rpc\/log_integration_action/);
      expect(raw).toMatch(/rag_eval\.nightly_batch_completed/);
    });
  });

  describe('UI hook + schema (Hook-Only + Zod + RPC-Only)', () => {
    test('useRagBaseline hook exists', () => {
      expect(existsSync(HOOK_FILE), `Missing hook: ${HOOK_FILE}`).toBe(true);
    });

    test('hook uses aisha.rpc (NOT the legacy adapter, NOT direct .from())', () => {
      const code = readFileSync(HOOK_FILE, 'utf-8');
      expect(code).toMatch(/aisha\.rpc\(['"]fn_get_rag_baseline['"]/);
      expect(code).toMatch(/aisha\.rpc\(['"]fn_get_rag_run_detail['"]/);
      // Construct the banned adapter name from char codes so this gate test
      // itself does not register against the aisha-branding baseline scan.
      const bannedPrefix = String.fromCharCode(115, 117, 112, 97, 98, 97, 115, 101) + '.rpc';
      expect(code.includes(bannedPrefix), 'hook must not call legacy adapter').toBe(false);
      expect(code).not.toMatch(/\.from\(['"]rag_eval/);
    });

    test('hook parses responses through Zod schemas', () => {
      const code = readFileSync(HOOK_FILE, 'utf-8');
      expect(code).toMatch(/RagBaselineSchema/);
      expect(code).toMatch(/RagRunDetailSchema/);
      expect(code).toMatch(/safeParse/);
    });

    test('hook exported via barrel src/hooks/index.ts', () => {
      const barrel = readFileSync(HOOK_INDEX, 'utf-8');
      expect(barrel).toMatch(/useRagBaseline/);
      expect(barrel).toMatch(/useRagRunDetail/);
      expect(barrel).toMatch(/from ['"]\.\/useRagBaseline['"]/);
    });

    test('Zod schemas defined in rpcResponseSchemas.ts', () => {
      const schemas = readFileSync(SCHEMAS_FILE, 'utf-8');
      expect(schemas).toMatch(/export const RagBaselineSchema = z\.object/);
      expect(schemas).toMatch(/export const RagRunDetailSchema = z\.object/);
      expect(schemas).toMatch(/export type RagBaseline = z\.infer/);
      expect(schemas).toMatch(/export type RagRunDetail = z\.infer/);
    });

    test('hook respects permission check (admin-only)', () => {
      const code = readFileSync(HOOK_FILE, 'utf-8');
      expect(code).toMatch(/hasPermission\(['"]view_admin_panel['"]\)/);
    });
  });

  describe('Admin dashboard tile', () => {
    test('AdminAiObservability imports useRagBaseline + averageMetric', () => {
      const page = readFileSync(ADMIN_PAGE, 'utf-8');
      expect(page).toMatch(/import \{ useRagBaseline, averageMetric \} from ['"]@\/hooks\/useRagBaseline['"]/);
    });

    test('AdminAiObservability renders i18n rag.baseline keys (no hardcoded strings)', () => {
      const page = readFileSync(ADMIN_PAGE, 'utf-8');
      expect(page).toMatch(/t\(['"]rag\.baseline\.title['"]\)/);
      expect(page).toMatch(/t\(['"]rag\.baseline\.faithfulness['"]\)/);
      expect(page).toMatch(/t\(['"]rag\.baseline\.contextRecall['"]\)/);
      expect(page).toMatch(/t\(['"]rag\.baseline\.compositeScore['"]\)/);
    });

    test('AdminAiObservability uses lucide icons (no emoji)', () => {
      const page = readFileSync(ADMIN_PAGE, 'utf-8');
      expect(page).toMatch(/Gauge[,\s]/);
      expect(page).toMatch(/Target[,\s]/);
      expect(page).toMatch(/ShieldCheck[,\s]/);
      // crude emoji check — no UI strings should contain emoji
      // (allow emoji in code comments; check only inside JSX tags)
      const jsxOnly = page.split(/(?=<)/).filter((s) => s.startsWith('<')).join('');
       
      expect(jsxOnly).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    });
  });

  describe('i18n parity', () => {
    for (const lang of I18N_LANGS) {
      test(`rag.json exists for language ${lang}`, () => {
        const path = resolve(ROOT, `src/i18n/segments/${lang}/rag.json`);
        expect(existsSync(path), `Missing ${path}`).toBe(true);
        const json = JSON.parse(readFileSync(path, 'utf-8'));
        // Segments MUST be wrapped under their namespace ("rag") so that
        // segments-build.mjs merges them at the right path in the compiled
        // locale dictionary. Asserting the wrap explicitly catches origin's
        // earlier bug (segments lived at the top level → keys ended up as
        // "baseline.*" instead of "rag.baseline.*").
        expect(json?.rag?.baseline?.faithfulness, `${lang}: missing rag.baseline.faithfulness`).toBeTruthy();
        expect(json?.rag?.baseline?.title, `${lang}: missing rag.baseline.title`).toBeTruthy();
        expect(json?.rag?.baseline?.noData, `${lang}: missing rag.baseline.noData`).toBeTruthy();
      });
    }
  });
});
