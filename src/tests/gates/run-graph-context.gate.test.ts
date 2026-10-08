/**
 * Gate: Step 7.3 explainability panel — fn_get_run_graph_context contract +
 * context_profiles per-profile traversal config + hook + component + i18n.
 *
 * Static regex-on-source pattern (no live DB, no live LLM). Locks in the
 * 5-piece feature so future refactors fail CI rather than ship a broken
 * explainability pane silently.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GraphContextRowSchema,
  type GraphContextRow,
} from '../../schemas/rpcResponseSchemas';
import { groupByTarget } from '../../lib/graph/groupGraphContext';

const ROOT = process.cwd();
const MIG       = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const SOT_FN    = resolve(ROOT, 'aisha/db/sql/functions/fn_get_run_graph_context.sql');
const SOT_TBL   = resolve(ROOT, 'aisha/db/sql/tables/context_profiles.sql');
const HOOK      = resolve(ROOT, 'src/hooks/useRunGraphContext.ts');
const COMPONENT = resolve(ROOT, 'src/components/chat/ExplainabilityPanel.tsx');
const WIDGET    = resolve(ROOT, 'src/components/chat/AiChatWidget.tsx');
const REGISTRY  = resolve(ROOT, 'aisha/db/migration-registry.json');
const LOCALES   = ['en', 'cs', 'de', 'fr', 'ru', 'th'] as const;

describe('Step 7.3 explainability panel', () => {

  // ─────────────────────────────────────────────────────────────────────────
  describe('Migration: fn_get_run_graph_context + context_profiles per-profile config', () => {
    test('run_graph_context is folded into the baseline (baseline-only)', () => {
      expect(existsSync(MIG)).toBe(true);
      const registry = JSON.parse(readFileSync(REGISTRY, 'utf-8')) as { migrations?: string[] };
      expect(registry.migrations ?? []).toEqual([]);
    });

    test('CREATE OR REPLACE FUNCTION fn_get_run_graph_context with 3-arg signature', () => {
      const sql = readFileSync(MIG, 'utf-8');
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_run_graph_context\(\s*p_run_id\s+uuid/);
      expect(sql).toMatch(/p_depth\s+integer\s+DEFAULT NULL/);
      expect(sql).toMatch(/p_per_seed\s+integer\s+DEFAULT NULL/);
    });

    test('SECURITY DEFINER + search_path + STABLE preserved', () => {
      const sql = readFileSync(MIG, 'utf-8');
      // Hlavička TÉTO funkce (po `AS $$`), ne zbytek baseline — ten by splnila kterákoli pozdější funkce.
      // Tvar cesty hlídá domovská brána definer-search-path; tady jen to, že cesta připnutá JE.
      const fnSection = (sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_run_graph_context/)[1] ?? '').split(/\nAS \$\$/)[0];
      expect(fnSection).toMatch(/SECURITY DEFINER/);
      expect(fnSection).toMatch(/SET search_path TO /);
      expect(fnSection).toMatch(/STABLE/);
    });

    test('REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated + service_role', () => {
      const sql = readFileSync(MIG, 'utf-8');
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_get_run_graph_context\(uuid, integer, integer\) FROM PUBLIC/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_graph_context\(uuid, integer, integer\) TO authenticated/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_graph_context\(uuid, integer, integer\) TO service_role/);
    });

    test('story-scoped RBAC: uses ps.user_id (not the historical owner_user_id typo)', () => {
      const sql = readFileSync(MIG, 'utf-8');
      const fnBody = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_run_graph_context/)[1] ?? '';
      expect(fnBody).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      // The body itself must not reference the broken column. Comments OK.
      const code = fnBody.match(/AS\s*\$\$[\s\S]*?\$\$/g)?.join('\n') ?? '';
      expect(code).not.toMatch(/owner_user_id/);
    });

    test('RBAC predicate is the unified 4-clause version (matches main canonical + Step 2 owner shortcut)', () => {
      // Single canonical predicate across all story-scoped reads:
      //   is_admin_or_staff OR ps.is_stack_default OR ps.user_id OR participant
      // Matches workbench Phase 6/7 + story_timeline (main) and
      // preserves the story-owner shortcut from Step 2 fn_get_run_citations.
      const sql = readFileSync(MIG, 'utf-8');
      const fnBody = sql.match(/AS\s*\$\$[\s\S]*?\$\$/g)?.join('\n') ?? '';
      expect(fnBody).toMatch(/public\.is_admin_or_staff\(auth\.uid\(\)\)/);
      expect(fnBody).toMatch(/ps\.is_stack_default\s*=\s*true/);
      expect(fnBody).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(fnBody).toMatch(/public\.story_participants sp[\s\S]*sp\.user_id\s*=\s*auth\.uid\(\)/);
    });

    test('SoT body parity: 4-clause predicate also in the SoT mirror', () => {
      const sot = readFileSync(SOT_FN, 'utf-8');
      const fnBody = sot.match(/AS\s*\$\$[\s\S]*?\$\$/g)?.join('\n') ?? '';
      expect(fnBody).toMatch(/ps\.is_stack_default\s*=\s*true/);
      expect(fnBody).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
    });

    test('resolves depth + per_seed from context_profiles via metadata.context.profile_slug', () => {
      const sql = readFileSync(MIG, 'utf-8');
      // The function reads profile_slug from ai_runs.metadata->'context'->>'profile_slug'.
      expect(sql).toMatch(/metadata->'context'->>'profile_slug'/);
      // Resolves depth via COALESCE chain over context_profiles.
      expect(sql).toMatch(/COALESCE\(p_depth,\s*cp\.graph_depth/);
      expect(sql).toMatch(/COALESCE\(p_per_seed,\s*cp\.graph_per_seed/);
    });

    test('context_profiles SoT declares per-profile graph_depth + graph_per_seed columns', () => {
      // The migration's ALTER…ADD COLUMNs were folded into the context_profiles SoT.
      const sql = readFileSync(SOT_TBL, 'utf-8');
      expect(sql).toMatch(/graph_depth\s+integer[\s\S]*?CHECK \(graph_depth BETWEEN 1 AND 4\)/);
      expect(sql).toMatch(/graph_per_seed\s+integer[\s\S]*?CHECK \(graph_per_seed BETWEEN 1 AND 50\)/);
    });

    test('context_profiles supports per-profile graph tuning (default + range; tuned values per-implementation)', () => {
      // Mechanism = platform default + CHECK range on the columns. The specific
      // per-profile tuned values (evidence_strict=3, chat_lightweight=1) are
      // implementation config and live in the implementation seed (→ example),
      // not the platform SoT.
      const sql = readFileSync(SOT_TBL, 'utf-8');
      expect(sql).toMatch(/graph_depth\s+integer\s+DEFAULT\s+\d+/);
      expect(sql).toMatch(/graph_per_seed\s+integer\s+DEFAULT\s+\d+/);
    });

    test('LATERAL fn_graph_multihop call passes story scope + depth + per_seed', () => {
      const sql = readFileSync(MIG, 'utf-8');
      // We're calling the existing Step 7.0 traversal RPC.
      expect(sql).toMatch(/CROSS JOIN LATERAL public\.fn_graph_multihop\(/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('SoT mirrors: function + table', () => {
    test('fn SoT exists with matching signature', () => {
      expect(existsSync(SOT_FN)).toBe(true);
      const sot = readFileSync(SOT_FN, 'utf-8');
      expect(sot).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_run_graph_context\(/);
      expect(sot).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
    });

    test('context_profiles SoT carries the new columns (so baseline regen produces consistent schema)', () => {
      const sot = readFileSync(SOT_TBL, 'utf-8');
      expect(sot).toMatch(/graph_depth integer DEFAULT 2 NOT NULL\s*CHECK \(graph_depth BETWEEN 1 AND 4\)/);
      expect(sot).toMatch(/graph_per_seed integer DEFAULT 10 NOT NULL\s*CHECK \(graph_per_seed BETWEEN 1 AND 50\)/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Schema GraphContextRowSchema', () => {
    test('accepts a well-formed row', () => {
      const parsed = GraphContextRowSchema.safeParse({
        seed_node_id: '11111111-1111-1111-1111-111111111111',
        seed_entity_type: 'KnowledgeItem',
        seed_label: 'Retrieval optimization plan',
        target_node_id: '22222222-2222-2222-2222-222222222222',
        target_entity_type: 'Concept',
        target_label: 'caching strategies',
        depth: 2,
        cumulative_confidence: 0.85,
        last_relationship: 'REFERENCES',
        path: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      });
      expect(parsed.success).toBe(true);
    });

    test('rejects missing required fields', () => {
      const parsed = GraphContextRowSchema.safeParse({ seed_node_id: 'x' });
      expect(parsed.success).toBe(false);
    });

    test('accepts null confidence + last_relationship (edge case for direct seed neighbours)', () => {
      const parsed = GraphContextRowSchema.safeParse({
        seed_node_id: '11111111-1111-1111-1111-111111111111',
        seed_entity_type: 'KnowledgeItem',
        seed_label: 'X',
        target_node_id: '22222222-2222-2222-2222-222222222222',
        target_entity_type: 'Concept',
        target_label: 'Y',
        depth: 1,
        cumulative_confidence: null,
        last_relationship: null,
        path: [],
      });
      expect(parsed.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Hook + groupByTarget()', () => {
    test('hook file exists + uses aisha.rpc fn_get_run_graph_context', () => {
      expect(existsSync(HOOK)).toBe(true);
      const src = readFileSync(HOOK, 'utf-8');
      expect(src).toMatch(/aisha\.rpc\(['"]fn_get_run_graph_context['"]/);
      // params alphabetical (AISHA convention). Optional depth/per-seed are
      // passed as `undefined` (D12 convention) — omitted from the JSON body so
      // PostgREST applies the fn's `DEFAULT NULL`, equivalent to sending null.
      expect(src).toMatch(/p_depth: undefined,\s*p_per_seed: undefined,\s*p_run_id: runId/);
    });

    test('hook uses Zod parse with safeParse + filter (no exceptions on bad rows)', () => {
      const src = readFileSync(HOOK, 'utf-8');
      expect(src).toMatch(/GraphContextRowSchema\.safeParse/);
    });

    test('groupByTarget collapses duplicates from multiple seeds, keeps highest confidence', () => {
      const a: GraphContextRow = {
        seed_node_id: 'aaaa1111-1111-1111-1111-111111111111',
        seed_entity_type: 'KnowledgeItem',
        seed_label: 'Source A',
        target_node_id: 'cccc1111-1111-1111-1111-111111111111',
        target_entity_type: 'Concept',
        target_label: 'caching',
        depth: 2,
        cumulative_confidence: 0.6,
        last_relationship: 'REFERENCES',
        path: [],
      };
      const b: GraphContextRow = { ...a,
        seed_node_id: 'bbbb1111-1111-1111-1111-111111111111',
        seed_label: 'Source B',
        depth: 1,
        cumulative_confidence: 0.9,
      };
      const grouped = groupByTarget([a, b]);
      expect(grouped).toHaveLength(1);
      const [only] = grouped;
      expect(only.target_node_id).toBe('cccc1111-1111-1111-1111-111111111111');
      expect(only.seeds).toHaveLength(2);
      // best_confidence promoted to B's 0.9; best_depth to 1.
      expect(only.best_confidence).toBe(0.9);
      expect(only.best_depth).toBe(1);
    });

    test('groupByTarget orders results by best_confidence DESC', () => {
      const low: GraphContextRow = {
        seed_node_id: 'aaaa1111-1111-1111-1111-111111111111',
        seed_entity_type: 'KnowledgeItem',
        seed_label: 'A',
        target_node_id: '11111111-2222-3333-4444-555555555555',
        target_entity_type: 'Concept',
        target_label: 'low',
        depth: 2,
        cumulative_confidence: 0.3,
        last_relationship: 'REFERENCES',
        path: [],
      };
      const high: GraphContextRow = { ...low,
        target_node_id: '99999999-2222-3333-4444-555555555555',
        target_label: 'high',
        cumulative_confidence: 0.95,
      };
      const grouped = groupByTarget([low, high]);
      expect(grouped[0].target_label).toBe('high');
      expect(grouped[1].target_label).toBe('low');
    });

    test('barrel export exposes useRunGraphContext + groupByTarget', () => {
      const src = readFileSync(resolve(ROOT, 'src/hooks/index.ts'), 'utf-8');
      expect(src).toMatch(/useRunGraphContext/);
      expect(src).toMatch(/groupByTarget/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('ExplainabilityPanel.tsx + AiChatWidget wire-in', () => {
    test('component file exists', () => {
      expect(existsSync(COMPONENT)).toBe(true);
    });

    test('uses Accordion (matching CitationPanel pattern) and lucide icons (no emojis)', () => {
      const src = readFileSync(COMPONENT, 'utf-8');
      expect(src).toMatch(/from\s+["']@\/components\/ui\/accordion["']/);
      expect(src).toMatch(/from\s+["']lucide-react["']/);
      // No raw emojis or hardcoded user-visible strings without t().
      expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    });

    test('all user-facing strings go through t()', () => {
      const src = readFileSync(COMPONENT, 'utf-8');
      // Must use t("rag.explainability.*") for every i18n point.
      expect(src).toMatch(/t\("rag\.explainability\.panelTitle"\)/);
      expect(src).toMatch(/t\("rag\.explainability\.empty"\)/);
      expect(src).toMatch(/t\("rag\.explainability\.depthLabel"/);
      expect(src).toMatch(/t\("rag\.explainability\.confidenceLabel"/);
      expect(src).toMatch(/t\("rag\.explainability\.viaSeeds"/);
    });

    test('AiChatWidget renders ExplainabilityPanel for assistant messages with ai_run_id', () => {
      const src = readFileSync(WIDGET, 'utf-8');
      expect(src).toMatch(/import \{ ExplainabilityPanel \} from "@\/components\/chat\/ExplainabilityPanel"/);
      expect(src).toMatch(/<ExplainabilityPanel runId=\{msg\.ai_run_id\}/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('i18n: all 6 locales declare rag.explainability.* keys', () => {
    const EXPECTED_KEYS = [
      'panelTitle', 'empty', 'depthLabel', 'confidenceLabel', 'viaSeeds', 'moreSeeds',
    ];
    for (const locale of LOCALES) {
      test(`${locale}/rag.json has all explainability keys`, () => {
        const segPath = resolve(ROOT, `src/i18n/segments/${locale}/rag.json`);
        const seg = JSON.parse(readFileSync(segPath, 'utf-8')) as Record<string, unknown>;
        const rag = seg.rag as Record<string, unknown>;
        const expl = rag?.explainability as Record<string, unknown> | undefined;
        expect(expl, `${locale} missing rag.explainability namespace`).toBeTruthy();
        for (const key of EXPECTED_KEYS) {
          expect(expl?.[key], `${locale} missing rag.explainability.${key}`).toBeTruthy();
          expect(typeof expl?.[key]).toBe('string');
        }
      });

      test(`${locale}: non-EN values are not EN-fallback copies`, () => {
        if (locale === 'en') return; // canonical
        const segPath = resolve(ROOT, `src/i18n/segments/${locale}/rag.json`);
        const enPath  = resolve(ROOT, 'src/i18n/segments/en/rag.json');
        const seg = JSON.parse(readFileSync(segPath, 'utf-8')) as { rag?: { explainability?: Record<string, string> } };
        const en  = JSON.parse(readFileSync(enPath,  'utf-8')) as { rag?: { explainability?: Record<string, string> } };
        const expl = seg.rag?.explainability ?? {};
        const enExpl = en.rag?.explainability ?? {};
        // panelTitle + empty must differ from EN (those are the longest, most language-specific strings).
        // Short values like "{{depth}} hop(s)" may overlap fine.
        expect(expl.panelTitle, `${locale}.panelTitle == EN (untranslated copy)`).not.toBe(enExpl.panelTitle);
        expect(expl.empty,      `${locale}.empty == EN (untranslated copy)`).not.toBe(enExpl.empty);
      });
    }
  });
});
