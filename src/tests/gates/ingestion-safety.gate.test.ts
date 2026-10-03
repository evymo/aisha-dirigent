/**
 * Gate: Step 4 ingestion safety + retrieval quarantine filter (systemic).
 *
 * Step 4 of the AISHA retrieval optimization plan adds a prompt-injection
 * guard at ingestion time. This gate validates the four artefacts as a
 * single integral feature, static-inspecting source files (no live DB):
 *
 *   1. Retrieval filter migration (20260519020000) — the security-critical
 *      piece. The earlier Step 4 migration added quarantine_status but did
 *      NOT wire it into mcp_search_knowledge_v2 / _v3. Without this filter
 *      the scanner would tag items but retrieval would still return them.
 *      The SoT mirrors must agree with the migration body.
 *
 *   2. Scanner lib (services/svc-mcp-knowledge/src/lib/ingestion-safety.ts)
 *      — two-stage scoring (heuristic + LLM via capability-resolver
 *      rag.safety_scan), combined via max(), threshold-based status map.
 *      No hardcoded model IDs (dynamic capability principle).
 *
 *   3. Route hook in knowledge-embeddings.ts — scanForInjection MUST run
 *      BEFORE buildChunksForItem so quarantined items never reach the
 *      embedding pipeline. On non-clear status, fn_record_safety_scan_audited
 *      records the verdict and the loop `continue`s.
 *
 *   4. Admin review UI — useQuarantinedKnowledge / useReinstateKnowledgeItem
 *      hooks (Zod-parsed, gated by view_admin_panel permission); the
 *      AdminKnowledgeQuarantine page wires them with i18n keys and lucide
 *      icons (no emoji, no hardcoded strings).
 *
 * The gate is intentionally static (regex-on-source) to keep it fast and
 * deterministic — matches the pattern set by critic-loop-integration.gate.test.ts.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

// Layer 1 — retrieval filter migration + SoT mirrors
// Layer 1 retrieval-filter DDL now lives in the canonical RPC SoT files (the
// quarantine-filter migration was absorbed into the baseline). Concatenate the
// v2 + v3 function SoT so the security-property assertions below stay scoped to
// exactly these RPCs.
const FILTER_MIGRATION =
  readFileSync(resolve(ROOT, 'aisha/db/sql/functions/mcp_search_knowledge_v2.sql'), 'utf-8') +
  '\n' +
  readFileSync(resolve(ROOT, 'aisha/db/sql/functions/mcp_search_knowledge_v3.sql'), 'utf-8');
const V2_SOT           = resolve(ROOT, 'aisha/db/sql/functions/mcp_search_knowledge_v2.sql');

// Layer 2 — scanner library
const SCANNER_LIB      = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/ingestion-safety.ts');

// Layer 3 — route hook
const EMBED_ROUTE      = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts');

// Layer 4 — admin review queue
const QUARANTINE_HOOK  = resolve(ROOT, 'src/hooks/useQuarantinedKnowledge.ts');
const QUARANTINE_PAGE  = resolve(ROOT, 'src/pages/admin/AdminKnowledgeQuarantine.tsx');
const HOOKS_BARREL     = resolve(ROOT, 'src/hooks/index.ts');

// i18n parity (already enforced by npm run i18n:check, but spot-check the
// quarantine subtree exists in every locale; cheap insurance against silent
// regressions).
const I18N_LANGS = ['en', 'cs', 'de', 'fr', 'ru', 'th'] as const;

describe('Step 4 ingestion safety + retrieval quarantine filter', () => {

  // ─────────────────────────────────────────────────────────────────────────
  describe('Layer 1: retrieval filter migration (security-critical)', () => {
    test('retrieval filter SoT files exist', () => {
      expect(FILTER_MIGRATION.length).toBeGreaterThan(0);
    });

    test('rewrites both v2 and v3 retrieval RPCs via CREATE OR REPLACE', () => {
      const sql = FILTER_MIGRATION;
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v2/);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v3/);
    });

    test('v2 WHERE clause filters flagged + quarantined items', () => {
      const sql = FILTER_MIGRATION;
      // The filter must be in the v2 function body (between its CREATE OR
      // REPLACE and the GRANT block).
      const v2Section = sql.split(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v2/)[1]
        ?.split(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v3/)[0] ?? '';
      expect(v2Section).toMatch(/ki\.quarantine_status\s+NOT\s+IN\s+\(\s*'flagged'\s*,\s*'quarantined'\s*\)/);
    });

    test('v3 WHERE clause filters flagged + quarantined items on BOTH v1 + v2 paths', () => {
      const sql = FILTER_MIGRATION;
      const v3Section = sql.split(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v3/)[1] ?? '';
      // v3 has two RETURN QUERY branches (v1 and v2); both must filter.
      const matches = v3Section.match(/ki\.quarantine_status\s+NOT\s+IN\s+\(\s*'flagged'\s*,\s*'quarantined'\s*\)/g);
      expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    test('reviewed + reinstated states are TREATED AS CLEAN (not in NOT IN list)', () => {
      const sql = FILTER_MIGRATION;
      // Negative gate: NOT IN clauses must NOT contain reviewed/reinstated.
      const notInClauses = sql.match(/quarantine_status\s+NOT\s+IN[^)]+\)/gi) ?? [];
      for (const clause of notInClauses) {
        expect(clause).not.toMatch(/'reviewed'/);
        expect(clause).not.toMatch(/'reinstated'/);
      }
    });

    test('SECURITY DEFINER + SET search_path preserved on both RPCs', () => {
      const sql = FILTER_MIGRATION;
      const sd = sql.match(/SECURITY DEFINER/g) ?? [];
      const sp = sql.match(/SET search_path TO/g) ?? [];
      // Both retrieval RPCs (and every live overload) are SECURITY DEFINER with
      // a pinned search_path. The SoT carries all overloads, so assert the floor
      // rather than the migration's point-in-time count of exactly 2.
      expect(sd.length).toBeGreaterThanOrEqual(2);
      expect(sp.length).toBeGreaterThanOrEqual(2);
    });

    test('GRANT block preserved (REVOKE + explicit GRANT to anon/authenticated/service_role)', () => {
      const sql = FILTER_MIGRATION;
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION mcp_search_knowledge_v2/);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION mcp_search_knowledge_v3/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v2[^;]+TO\s+(?:anon|authenticated|service_role)/);
    });

    test('v2 SoT mirror has matching quarantine filter (no drift)', () => {
      const sot = readFileSync(V2_SOT, 'utf-8');
      expect(sot).toMatch(/ki\.quarantine_status\s+NOT\s+IN\s+\(\s*'flagged'\s*,\s*'quarantined'\s*\)/);
    });

    test('quarantine filter is folded into the baseline (baseline-only state)', () => {
      // The 20260519020000_quarantine_retrieval_filter migration was absorbed into
      // the baseline; the filter itself is asserted on the v2/v3 RPC SoT above.
      // Here assert the baseline-only invariant: 0 pending non-baseline migrations
      // (the registry no longer tracks individual deltas — durability is in SoT).
      const registry = JSON.parse(readFileSync(resolve(ROOT, 'aisha/db/migration-registry.json'), 'utf-8')) as {
        migrations?: string[];
      };
      expect(registry.migrations ?? []).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Layer 2: scanner library (heuristic + LLM via capability-resolver)', () => {
    test('lib file exists', () => {
      expect(existsSync(SCANNER_LIB)).toBe(true);
    });

    test('exports scanForInjection entry point with SafetyStatus + SafetyScanResult types', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      expect(code).toMatch(/export\s+async\s+function\s+scanForInjection/);
      expect(code).toMatch(/export\s+type\s+SafetyStatus/);
      expect(code).toMatch(/export\s+interface\s+SafetyScanResult/);
    });

    test('heuristic stage covers the documented injection patterns', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      // The plan calls these out explicitly — each MUST be a named matcher
      // so admin debugging can show "matched: <name>" in the audit trail.
      const requiredMatchers = [
        'ignore_previous_instructions',
        'system_prompt_override',
        'role_hijack_you_are_now',
        'developer_mode',
        'long_base64_blob',
        'dangerous_uri_scheme',
        'exfiltration_request',
      ];
      for (const name of requiredMatchers) {
        expect(code, `matcher "${name}" missing`).toMatch(new RegExp(`name:\\s*['"]${name}['"]`));
      }
    });

    test('LLM stage resolves backend via capability-resolver rag.safety_scan (dynamic, no hardcoded model)', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      expect(code).toMatch(/resolveRagBackend\(\s*['"]rag\.safety_scan['"]\s*\)/);
    });

    test('LLM call uses shared chatCompletionWithRetry helper (no custom HTTP client)', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      expect(code).toMatch(/chatCompletionWithRetry/);
      expect(code).toMatch(/from\s+['"]\.\/llm-completion\.js['"]/);
    });

    test('LLM stage degrades gracefully when backend null (heuristic-only path)', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      // If resolveRagBackend returns null, runLlmScan returns {score: null, ...}
      expect(code).toMatch(/if\s*\(\s*!backend\s*\)/);
    });

    test('combined score = max(heuristic, llm) (LLM only adds, never subtracts)', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      expect(code).toMatch(/Math\.max\s*\(\s*heuristic\.score\s*,\s*llm\.score\s*\?\?\s*0\s*\)/);
    });

    test('threshold map: >=0.7 quarantined, >=0.4 flagged, else clear', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      expect(code).toMatch(/combinedScore\s*>=\s*0\.7/);
      expect(code).toMatch(/combinedScore\s*>=\s*0\.4/);
      expect(code).toMatch(/['"]quarantined['"]/);
      expect(code).toMatch(/['"]flagged['"]/);
      expect(code).toMatch(/['"]clear['"]/);
    });

    test('LLM judge prompt is JSON-strict, temperature=0 (deterministic)', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      expect(code).toMatch(/temperature:\s*0/);
      expect(code).toMatch(/json_mode:\s*true/);
    });

    test('uses safe logger (no console.log)', () => {
      const code = readFileSync(SCANNER_LIB, 'utf-8');
      expect(code).toMatch(/createSafeLogger/);
      expect(code).not.toMatch(/console\.log/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Layer 3: route hook in knowledge-embeddings.ts', () => {
    test('imports scanForInjection from the scanner lib', () => {
      const code = readFileSync(EMBED_ROUTE, 'utf-8');
      expect(code).toMatch(/import\s*{\s*scanForInjection\s*}\s+from\s+['"]\.\.\/lib\/ingestion-safety\.js['"]/);
    });

    test('scan runs BEFORE buildChunksForItem call site (so quarantined items never embed)', () => {
      const code = readFileSync(EMBED_ROUTE, 'utf-8');
      const scanIdx = code.indexOf('scanForInjection(');
      // Skip the function definition (line 121: `function buildChunksForItem(item:`)
      // and target only the call site (object literal `buildChunksForItem({`).
      const chunkCallIdx = code.indexOf('buildChunksForItem({');
      expect(scanIdx, 'scanForInjection call site').toBeGreaterThan(0);
      expect(chunkCallIdx, 'buildChunksForItem call site').toBeGreaterThan(0);
      expect(scanIdx).toBeLessThan(chunkCallIdx);
    });

    test('non-clear status calls fn_record_safety_scan_audited then continue', () => {
      const code = readFileSync(EMBED_ROUTE, 'utf-8');
      expect(code).toMatch(/scan\.status\s*!==\s*['"]clear['"]/);
      expect(code).toMatch(/['"]fn_record_safety_scan_audited['"]/);
      // The continue MUST come within the same if-block so the loop skips
      // this item — otherwise the embedding pipeline would still run on a
      // quarantined item.
      const afterCheck = code.split(/scan\.status\s*!==\s*['"]clear['"]/)[1] ?? '';
      const block = afterCheck.split(/\n\s*\n/)[0] + (afterCheck.split(/\n\s*\n/)[1] ?? '');
      expect(block).toMatch(/continue;/);
    });

    test('results push records quarantined/flagged status for caller telemetry', () => {
      const code = readFileSync(EMBED_ROUTE, 'utf-8');
      expect(code).toMatch(/scan\.status\s*===\s*['"]quarantined['"]\s*\?\s*['"]quarantined['"]\s*:\s*['"]flagged['"]/);
    });

    test('safety scan params are alphabetical (RPC convention)', () => {
      const code = readFileSync(EMBED_ROUTE, 'utf-8');
      // The RPC call block should pass p_item_id, p_metadata, p_reason,
      // p_score, p_status in that order.
      const m = code.match(/fn_record_safety_scan_audited[^}]*\}/);
      expect(m, 'expected fn_record_safety_scan_audited call block').toBeTruthy();
      const params = m![0].match(/p_[a-z_]+/g) ?? [];
      const sorted = [...params].sort();
      expect(params).toEqual(sorted);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Layer 4: admin quarantine queue (hook + page)', () => {
    test('useQuarantinedKnowledge hook exists', () => {
      expect(existsSync(QUARANTINE_HOOK)).toBe(true);
    });

    test('hook exports Zod schema + both query and mutation hooks', () => {
      const code = readFileSync(QUARANTINE_HOOK, 'utf-8');
      expect(code).toMatch(/export\s+const\s+QuarantinedKnowledgeItemSchema/);
      expect(code).toMatch(/export\s+function\s+useQuarantinedKnowledge/);
      expect(code).toMatch(/export\s+function\s+useReinstateKnowledgeItem/);
    });

    test('hook gates on view_admin_panel permission (no leaking quarantine queue to users)', () => {
      const code = readFileSync(QUARANTINE_HOOK, 'utf-8');
      expect(code).toMatch(/usePermissions/);
      expect(code).toMatch(/hasPermission\(\s*['"]view_admin_panel['"]\s*\)/);
    });

    test('hook calls fn_list_quarantined_items + fn_reinstate_knowledge_item_audited via aisha.rpc', () => {
      const code = readFileSync(QUARANTINE_HOOK, 'utf-8');
      expect(code).toMatch(/aisha\.rpc\(\s*['"]fn_list_quarantined_items['"]/);
      expect(code).toMatch(/aisha\.rpc\(\s*['"]fn_reinstate_knowledge_item_audited['"]/);
      // RPC-Only invariant: never .from().select() here.
      expect(code).not.toMatch(/\.from\(/);
    });

    test('reinstate mutation invalidates the quarantine list query on success', () => {
      const code = readFileSync(QUARANTINE_HOOK, 'utf-8');
      expect(code).toMatch(/invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]quarantined-knowledge['"]\s*\]\s*\}\s*\)/);
    });

    test('reinstate mutation uses safeError (no console.log) on failure', () => {
      const code = readFileSync(QUARANTINE_HOOK, 'utf-8');
      expect(code).toMatch(/safeError\(/);
      expect(code).not.toMatch(/console\.log\(/);
    });

    test('hook is exported from src/hooks/index.ts barrel', () => {
      const barrel = readFileSync(HOOKS_BARREL, 'utf-8');
      expect(barrel).toMatch(/['"]\.\/useQuarantinedKnowledge['"]/);
    });

    test('AdminKnowledgeQuarantine page exists', () => {
      expect(existsSync(QUARANTINE_PAGE)).toBe(true);
    });

    test('page uses i18n keys from rag.quarantine.* — no hardcoded UI strings', () => {
      const code = readFileSync(QUARANTINE_PAGE, 'utf-8');
      expect(code).toMatch(/useTranslation/);
      // Spot-check the headline keys are all referenced via t().
      const requiredKeys = [
        'rag.quarantine.title',
        'rag.quarantine.subtitle',
        'rag.quarantine.queueTitle',
        'rag.quarantine.queueDescription',
        'rag.quarantine.empty',
        'rag.quarantine.reinstate',
        'rag.quarantine.confirmReinstate',
        'rag.quarantine.reasonRequired',
        'rag.quarantine.reinstated',
        'rag.quarantine.reinstateError',
      ];
      for (const k of requiredKeys) {
        expect(code, `i18n key "${k}" missing in admin page`).toContain(k);
      }
    });

    test('page uses lucide-react icons (no emoji)', () => {
      const code = readFileSync(QUARANTINE_PAGE, 'utf-8');
      expect(code).toMatch(/from\s+['"]lucide-react['"]/);
      // ShieldAlert / ShieldCheck / AlertCircle / RotateCcw drive the visual
      // affordance for status + reinstate action.
      expect(code).toMatch(/ShieldAlert/);
      expect(code).toMatch(/RotateCcw/);
    });

    test('page short-circuits when admin permission absent (permissionDenied alert)', () => {
      const code = readFileSync(QUARANTINE_PAGE, 'utf-8');
      expect(code).toMatch(/hasPermission\(\s*['"]view_admin_panel['"]\s*\)/);
      expect(code).toMatch(/common\.permissionDenied/);
    });

    test('reinstate flow requires non-empty reason before mutateAsync (audit trail enforced UI-side)', () => {
      const code = readFileSync(QUARANTINE_PAGE, 'utf-8');
      // The UI-level guard mirrors the RPC-level validation: empty reason
      // toasts reasonRequired and skips the network call.
      expect(code).toMatch(/reinstateReason\.trim\(\)/);
      expect(code).toMatch(/rag\.quarantine\.reasonRequired/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Cross-layer i18n parity (rag.quarantine.* present in all locales)', () => {
    for (const lang of I18N_LANGS) {
      test(`rag.quarantine subtree present in ${lang}/rag.json`, () => {
        const path = resolve(ROOT, `src/i18n/segments/${lang}/rag.json`);
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw) as { rag?: { quarantine?: Record<string, string> } };
        const quarantine = parsed.rag?.quarantine ?? {};
        // Same keys as in en/rag.json — i18n:check already enforces shape
        // globally, but this catches accidental local drift on the Step 4
        // surface specifically.
        const requiredKeys = [
          'title', 'subtitle', 'queueTitle', 'queueDescription', 'empty',
          'score', 'reason', 'reinstate', 'reinstateReasonPlaceholder',
          'reasonRequired', 'confirmReinstate', 'reinstated',
          'reinstatedDescription', 'reinstateError',
        ];
        for (const k of requiredKeys) {
          expect(quarantine[k], `${lang}: rag.quarantine.${k} missing`).toBeTruthy();
        }
      });
    }
  });
});
