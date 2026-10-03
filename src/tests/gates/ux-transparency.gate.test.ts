/**
 * UX Transparency gate (Step 2 of retrieval optimization plan 2026).
 *
 * Verifies the citation/faithfulness/feedback wire-up by static inspection:
 *   - Migration adds ai_runs columns + message_user_feedback table + RLS
 *   - 3 RPCs (fn_get_run_citations, fn_get_run_faithfulness,
 *     fn_submit_message_feedback_audited) with canonical security pattern
 *   - SoT mirror files exist (rpc-sql-mapping gate)
 *   - Hook uses aisha.rpc + Zod parse (Hook-Only + RPC-Only)
 *   - i18n parity across 6 languages for chip + citations + feedback
 *
 * Component tests (FaithfulnessChip, CitationPanel rendering) live next to
 * the components in src/tests/components/ — this gate covers wire-up only.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MIGRATION  = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const SOT_CIT    = resolve(ROOT, 'aisha/db/sql/functions/fn_get_run_citations.sql');
const SOT_FAITH  = resolve(ROOT, 'aisha/db/sql/functions/fn_get_run_faithfulness.sql');
const SOT_FB     = resolve(ROOT, 'aisha/db/sql/functions/fn_submit_message_feedback_audited.sql');
const HOOK       = resolve(ROOT, 'src/hooks/useRunCitations.ts');
const SCHEMAS    = resolve(ROOT, 'src/schemas/rpcResponseSchemas.ts');
const I18N_LANGS = ['en', 'cs', 'de', 'fr', 'ru', 'th'];

describe('UX Transparency gate (Step 2)', () => {

  describe('Migration', () => {
    test('migration file exists', () => {
      expect(existsSync(MIGRATION), `Missing: ${MIGRATION}`).toBe(true);
    });

    test('ai_runs SoT declares faithfulness_score_estimate + citation_chunk_ids', () => {
      // The migration's ALTER…ADD COLUMNs were folded into the ai_runs table SoT.
      const sql = readFileSync(resolve(ROOT, 'aisha/db/sql/tables/ai_runs.sql'), 'utf-8');
      expect(sql).toMatch(/faithfulness_score_estimate/);
      expect(sql).toMatch(/citation_chunk_ids/);
    });

    test('creates message_user_feedback table with RLS + owner read policy', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.message_user_feedback/);
      expect(sql).toMatch(/ALTER TABLE public\.message_user_feedback\s+ENABLE ROW LEVEL SECURITY/);
      expect(sql).toMatch(/DROP POLICY IF EXISTS "message_user_feedback owner read"/);
      expect(sql).toMatch(/CREATE POLICY "message_user_feedback owner read"/);
    });

    test('creates all 3 RPCs with canonical security pattern', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      for (const fn of ['fn_get_run_citations', 'fn_get_run_faithfulness', 'fn_submit_message_feedback_audited']) {
        expect(sql, `Missing ${fn}`).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`));
      }
      const secDef = (sql.match(/SECURITY DEFINER/g) || []).length;
      expect(secDef).toBeGreaterThanOrEqual(3);
      const searchPath = (sql.match(/SET search_path TO 'public'/g) || []).length;
      expect(searchPath).toBeGreaterThanOrEqual(3);
    });

    test('fn_submit_message_feedback_audited writes audit_journal', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/'chat\.message_feedback'/);
    });

    test('REVOKE FROM PUBLIC + explicit GRANT on every RPC', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      const revokes = (sql.match(/REVOKE ALL ON FUNCTION public\.fn_/g) || []).length;
      expect(revokes).toBeGreaterThanOrEqual(3);
      const grants = (sql.match(/GRANT EXECUTE ON FUNCTION public\.fn_/g) || []).length;
      expect(grants).toBeGreaterThanOrEqual(6); // 3 RPCs × (authenticated + service_role)
    });
  });

  describe('SoT mirror files (rpc-sql-mapping)', () => {
    test('fn_get_run_citations SoT exists', () => {
      expect(existsSync(SOT_CIT)).toBe(true);
    });
    test('fn_get_run_faithfulness SoT exists', () => {
      expect(existsSync(SOT_FAITH)).toBe(true);
    });
    test('fn_submit_message_feedback_audited SoT exists', () => {
      expect(existsSync(SOT_FB)).toBe(true);
    });
  });

  describe('Hook (Hook-Only + RPC-Only)', () => {
    test('useRunCitations hook file exists', () => {
      expect(existsSync(HOOK)).toBe(true);
    });

    test('hook uses aisha.rpc for all 3 RPCs (not direct .from())', () => {
      const code = readFileSync(HOOK, 'utf-8');
      expect(code).toMatch(/aisha\.rpc\(['"]fn_get_run_citations['"]/);
      expect(code).toMatch(/aisha\.rpc\(['"]fn_get_run_faithfulness['"]/);
      expect(code).toMatch(/aisha\.rpc\(['"]fn_submit_message_feedback_audited['"]/);
      expect(code).not.toMatch(/\.from\(['"]message_user_feedback/);
      expect(code).not.toMatch(/\.from\(['"]knowledge_attribution/);
    });

    test('hook parses responses through Zod schemas', () => {
      const code = readFileSync(HOOK, 'utf-8');
      expect(code).toMatch(/CitationSchema\.safeParse/);
      expect(code).toMatch(/FaithfulnessScoreSchema\.safeParse/);
    });

    test('faithfulnessTier helper exported (UI severity mapping)', () => {
      const code = readFileSync(HOOK, 'utf-8');
      expect(code).toMatch(/export function faithfulnessTier/);
      expect(code).toMatch(/['"]high['"]/);
      expect(code).toMatch(/['"]medium['"]/);
      expect(code).toMatch(/['"]low['"]/);
      expect(code).toMatch(/['"]noData['"]/);
    });
  });

  describe('Zod schemas', () => {
    test('CitationSchema + FaithfulnessScoreSchema defined', () => {
      const schemas = readFileSync(SCHEMAS, 'utf-8');
      expect(schemas).toMatch(/export const CitationSchema = z\.object/);
      expect(schemas).toMatch(/export const FaithfulnessScoreSchema = z\.object/);
      expect(schemas).toMatch(/export type Citation = z\.infer/);
      expect(schemas).toMatch(/export type FaithfulnessScore = z\.infer/);
    });
  });

  describe('i18n parity (chip + citations + feedback × 6 langs)', () => {
    for (const lang of I18N_LANGS) {
      test(`rag.json for ${lang} has chip/citations/feedback sections`, () => {
        const path = resolve(ROOT, `src/i18n/segments/${lang}/rag.json`);
        const json = JSON.parse(readFileSync(path, 'utf-8'));
        // Segments MUST be wrapped under their namespace ("rag") so that
        // segments-build.mjs merges them at the right path in the compiled
        // locale dictionary. Runtime t() calls expect rag.chip.*,
        // rag.citations.*, rag.feedback.* — not top-level chip.* etc.
        expect(json.rag?.chip?.high, `${lang}: missing rag.chip.high`).toBeTruthy();
        expect(json.rag?.chip?.medium, `${lang}: missing rag.chip.medium`).toBeTruthy();
        expect(json.rag?.chip?.low, `${lang}: missing rag.chip.low`).toBeTruthy();
        expect(json.rag?.citations?.panelTitle, `${lang}: missing rag.citations.panelTitle`).toBeTruthy();
        expect(json.rag?.feedback?.thumbsUp, `${lang}: missing rag.feedback.thumbsUp`).toBeTruthy();
        expect(json.rag?.feedback?.submit, `${lang}: missing rag.feedback.submit`).toBeTruthy();
      });
    }
  });

  describe('Step 2 UI components (Step 2.U*)', () => {
    const FAITHFULNESS_CHIP = resolve(ROOT, 'src/components/chat/FaithfulnessChip.tsx');
    const CITATION_PANEL   = resolve(ROOT, 'src/components/chat/CitationPanel.tsx');
    const FEEDBACK_BUTTONS = resolve(ROOT, 'src/components/chat/FeedbackButtons.tsx');
    const AI_CHAT_WIDGET   = resolve(ROOT, 'src/components/chat/AiChatWidget.tsx');
    const USE_AI_CHAT      = resolve(ROOT, 'src/hooks/useAiChat.ts');

    test('FaithfulnessChip component exists + uses faithfulnessTier + lucide icons', () => {
      expect(existsSync(FAITHFULNESS_CHIP)).toBe(true);
      const code = readFileSync(FAITHFULNESS_CHIP, 'utf-8');
      expect(code).toMatch(/useRunFaithfulness/);
      expect(code).toMatch(/faithfulnessTier/);
      // No emoji — lucide icons only
      expect(code).toMatch(/ShieldCheck/);
      expect(code).toMatch(/AlertCircle/);
      expect(code).toMatch(/XCircle/);
      expect(code).toMatch(/HelpCircle/);
    });

    test('CitationPanel component exists + uses Accordion pattern + Link to /knowledge', () => {
      expect(existsSync(CITATION_PANEL)).toBe(true);
      const code = readFileSync(CITATION_PANEL, 'utf-8');
      expect(code).toMatch(/useRunCitations/);
      expect(code).toMatch(/Accordion[\s,]/);
      expect(code).toMatch(/AccordionContent/);
      // Link to per-item knowledge route
      expect(code).toMatch(/\/knowledge\//);
    });

    test('FeedbackButtons is dual-write (ALE + RAG eval) when aiRunId provided', () => {
      expect(existsSync(FEEDBACK_BUTTONS)).toBe(true);
      const code = readFileSync(FEEDBACK_BUTTONS, 'utf-8');
      // Existing ALE path still wired
      expect(code).toMatch(/useSubmitAiFeedback/);
      // New RAG eval path wired
      expect(code).toMatch(/useSubmitMessageFeedback/);
      // Dual-write pattern via Promise.allSettled
      expect(code).toMatch(/Promise\.allSettled/);
      // aiRunId prop declared (optional)
      expect(code).toMatch(/aiRunId\?:\s*string\s*\|\s*null/);
    });

    test('AiChatWidget renders FaithfulnessChip + CitationPanel under assistant messages', () => {
      const code = readFileSync(AI_CHAT_WIDGET, 'utf-8');
      expect(code).toMatch(/<FaithfulnessChip\s+runId=/);
      expect(code).toMatch(/<CitationPanel\s+runId=/);
      // FeedbackButtons gets aiRunId
      expect(code).toMatch(/aiRunId={msg\.ai_run_id/);
    });

    test('useAiChat propagates response.metadata.run_id onto ChatMessage.ai_run_id', () => {
      const code = readFileSync(USE_AI_CHAT, 'utf-8');
      // Schema includes ai_run_id
      expect(code).toMatch(/ai_run_id:\s*z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/);
      // onSuccess copies metadata.run_id onto assistant message
      expect(code).toMatch(/data\.metadata\?\.run_id/);
    });
  });
});
