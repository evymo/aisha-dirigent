/**
 * Gate: Step W1 platform warmup wizard.
 *
 * Locks in:
 *   - Warmup RPCs (state read + step write) with the right security posture
 *     (SECURITY DEFINER, search_path, REVOKE+GRANT) — read from canonical SoT
 *     (aisha/db/sql/functions/), since the migration is baseline-absorbed
 *   - SoT mirrors for both RPCs
 *   - Hook + schema contract
 *   - Wizard component renders all 5 steps + uses existing StoryKnowledgeTab
 *   - Route registered in router.tsx
 *   - Auto-redirect from AdminOverview when needs_warmup
 *   - i18n parity across en/cs/de/fr/ru/th — and non-EN values are NOT
 *     EN-fallback copies (per memory feedback_i18n_use_deepl_not_fallback)
 *
 * Static regex-on-source. Same pattern as compose-context-graph-layer +
 * run-graph-context gates. No live DB, no live LLM.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
// Canonical SoT only. The warmup RPCs were absorbed into the baseline; their
// per-function SoT mirrors are the immutable contract (the registry is
// baseline-only). Each function lives in its own aisha/db/sql/functions/ file.
const SOT_READ  = resolve(ROOT, 'aisha/db/sql/functions/fn_get_platform_warmup_state.sql');
const SOT_WRITE = resolve(ROOT, 'aisha/db/sql/functions/fn_mark_warmup_step_completed_audited.sql');
const SOT_BY_FN: Record<string, string> = {
  fn_get_platform_warmup_state:          SOT_READ,
  fn_mark_warmup_step_completed_audited: SOT_WRITE,
};
const HOOK      = resolve(ROOT, 'src/hooks/usePlatformWarmupState.ts');
const WIZARD    = resolve(ROOT, 'src/pages/admin/AdminWarmupWizard.tsx');
const OVERVIEW  = resolve(ROOT, 'src/pages/admin/AdminOverview.tsx');
const ROUTER    = resolve(ROOT, 'src/router.tsx');
const SCHEMAS   = resolve(ROOT, 'src/schemas/rpcResponseSchemas.ts');
const REGISTRY  = resolve(ROOT, 'aisha/db/migration-registry.json');
const LOCALES   = ['en', 'cs', 'de', 'fr', 'ru', 'th'] as const;

describe('Step W1 platform warmup wizard', () => {

  // ─────────────────────────────────────────────────────────────────────────
  describe('SoT functions: RPCs with right security posture', () => {
    test('both warmup RPC SoT files exist + registry is baseline-only', () => {
      expect(existsSync(SOT_READ)).toBe(true);
      expect(existsSync(SOT_WRITE)).toBe(true);
      // The warmup migration was absorbed into the baseline. The registry must
      // declare the baseline-only state — the per-function SoT mirrors are the
      // immutable contract (no non-baseline migration is listed in SoT).
      const registryRaw = readFileSync(REGISTRY, 'utf-8');
      expect(registryRaw).toMatch(/Baseline-only state/i);
    });

    const RPCS: Array<[name: string, sig: string]> = [
      ['fn_get_platform_warmup_state',                '()'],
      ['fn_mark_warmup_step_completed_audited',       '(text, jsonb)'],
    ];

    for (const [fn, sig] of RPCS) {
      test(`${fn}: CREATE OR REPLACE`, () => {
        const sql = readFileSync(SOT_BY_FN[fn], 'utf-8');
        expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
      });

      test(`${fn}: SECURITY DEFINER + search_path 'public'`, () => {
        const sql = readFileSync(SOT_BY_FN[fn], 'utf-8');
        const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
        const next  = sql.indexOf(`REVOKE ALL ON FUNCTION public.${fn}`, start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(next).toBeGreaterThan(start);
        const section = sql.slice(start, next);
        expect(section).toMatch(/SECURITY DEFINER/);
        expect(section).toMatch(/SET search_path TO 'public'/);
      });

      test(`${fn}: REVOKE ALL FROM PUBLIC explicit`, () => {
        const sql = readFileSync(SOT_BY_FN[fn], 'utf-8');
        const escSig = sig.replace(/[()]/g, (c) => `\\${c}`);
        expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}${escSig} FROM PUBLIC`));
      });
    }

    test('read RPC is STABLE (read-only)', () => {
      const sql = readFileSync(SOT_READ, 'utf-8');
      const section = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_platform_warmup_state/)[1]
        ?.split(/REVOKE ALL ON FUNCTION public\.fn_get_platform_warmup_state/)[0] ?? '';
      expect(section).toMatch(/STABLE/);
    });

    test('read RPC accepts service_role bypass (cold-start path)', () => {
      const sql = readFileSync(SOT_READ, 'utf-8');
      const section = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_platform_warmup_state/)[1]
        ?.split(/REVOKE ALL ON FUNCTION public\.fn_get_platform_warmup_state/)[0] ?? '';
      // Vlastnost: RPC má service_role bypass pro cold-start. NE pravopis:
      // dřív se tu hlídal doslovný tvar `v_is_service := … request.jwt.claims`,
      // což pinovalo idiom, který se skládá na NULL a dělá z deny-guardu
      // fail-open (2026-08-04, 73 funkcí). Kanonická čtečka is_service_role()
      // je totéž, jen totální — a brána deny-guard-null-fold ten starý tvar
      // dnes naopak ZAKAZUJE, takže by si obě brány protiřečily.
      expect(section).toMatch(/is_service_role\(\)|request\.jwt\.claims/);
      expect(section).toMatch(/IF NOT v_is_service AND NOT v_is_admin THEN/);
    });

    test("read RPC computes needs_warmup as inverse of 'complete' membership", () => {
      const sql = readFileSync(SOT_READ, 'utf-8');
      expect(sql).toMatch(/v_needs_warmup\s*:=\s*NOT\s*\('complete'\s*=\s*ANY\(v_completed_steps\)\)/);
    });

    test('read RPC counts active non-quarantined items in stack-default', () => {
      const sql = readFileSync(SOT_READ, 'utf-8');
      const section = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_platform_warmup_state/)[1] ?? '';
      expect(section).toMatch(/ki\.status = 'active'/);
      expect(section).toMatch(/quarantine_status.*NOT IN \('flagged', 'quarantined'\)/s);
    });

    test('write RPC validates step against the 5-value enum', () => {
      const sql = readFileSync(SOT_WRITE, 'utf-8');
      const section = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_mark_warmup_step_completed_audited/)[1] ?? '';
      for (const step of ['welcome', 'kb_upload', 'rules_setup', 'test_query', 'complete']) {
        expect(section, `step ${step} not in CHECK enum`).toMatch(new RegExp(`'${step}'`));
      }
    });

    test('write RPC blocks non-admin (no service_role bypass on writes)', () => {
      const sql = readFileSync(SOT_WRITE, 'utf-8');
      const section = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_mark_warmup_step_completed_audited/)[1] ?? '';
      // Block raises 42501. service_role NOT bypassed — wizard is admin-only
      // (audit forensic value).
      expect(section).toMatch(/IF NOT v_is_admin THEN[\s\S]*42501/);
      expect(section).not.toMatch(/v_is_service\s+OR\s+v_is_admin/);
    });

    test('write RPC inserts ONE audit_journal row per call', () => {
      const sql = readFileSync(SOT_WRITE, 'utf-8');
      const section = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_mark_warmup_step_completed_audited/)[1] ?? '';
      const inserts = (section.match(/INSERT INTO public\.audit_journal/g) ?? []).length;
      expect(inserts).toBe(1);
      expect(section).toMatch(/action,\s*action_type/);
      expect(section).toMatch(/'warmup\.step_completed'/);
    });

    test('no new table created — state lives in audit_journal', () => {
      // Neither warmup RPC SoT file declares a backing table; state is derived
      // from audit_journal rows.
      const readSql  = readFileSync(SOT_READ, 'utf-8');
      const writeSql = readFileSync(SOT_WRITE, 'utf-8');
      expect(readSql).not.toMatch(/CREATE TABLE.*warmup/);
      expect(writeSql).not.toMatch(/CREATE TABLE.*warmup/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('SoT mirrors: both functions', () => {
    test('SoT read mirror exists with matching signature', () => {
      expect(existsSync(SOT_READ)).toBe(true);
      const sot = readFileSync(SOT_READ, 'utf-8');
      expect(sot).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_platform_warmup_state\(\)/);
      expect(sot).toMatch(/SECURITY DEFINER/);
      expect(sot).toMatch(/STABLE/);
    });

    test('SoT write mirror exists with matching signature', () => {
      expect(existsSync(SOT_WRITE)).toBe(true);
      const sot = readFileSync(SOT_WRITE, 'utf-8');
      expect(sot).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_mark_warmup_step_completed_audited\(/);
      expect(sot).toMatch(/SECURITY DEFINER/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Hook + schema', () => {
    test('hook file exists + uses both RPCs', () => {
      expect(existsSync(HOOK)).toBe(true);
      const src = readFileSync(HOOK, 'utf-8');
      expect(src).toMatch(/aisha\.rpc\("fn_get_platform_warmup_state"/);
      expect(src).toMatch(/aisha\.rpc\("fn_mark_warmup_step_completed_audited"/);
    });

    test('hook gates query on hasPermission view_admin_panel', () => {
      const src = readFileSync(HOOK, 'utf-8');
      expect(src).toMatch(/hasPermission\("view_admin_panel"\)/);
    });

    test('hook uses Zod safeParse (no exceptions on bad data)', () => {
      const src = readFileSync(HOOK, 'utf-8');
      expect(src).toMatch(/PlatformWarmupStateSchema\.safeParse/);
      expect(src).toMatch(/WarmupStepCompletedSchema\.safeParse/);
    });

    test('hook invalidates the warmup state query after a step is marked', () => {
      const src = readFileSync(HOOK, 'utf-8');
      expect(src).toMatch(/invalidateQueries\(\{ queryKey: QUERY_KEY \}\)/);
    });

    test('schema declares 5-value WarmupStep enum + nullable last_step', () => {
      const src = readFileSync(SCHEMAS, 'utf-8');
      expect(src).toMatch(/WarmupStepSchema = z\.enum\(\[\s*'welcome',\s*'kb_upload',\s*'rules_setup',\s*'test_query',\s*'complete'/);
      expect(src).toMatch(/last_step:\s*WarmupStepSchema\.nullable\(\)/);
    });

    test('schema declares PlatformWarmupStateSchema with needs_warmup + default_story_id', () => {
      const src = readFileSync(SCHEMAS, 'utf-8');
      expect(src).toMatch(/PlatformWarmupStateSchema[\s\S]*needs_warmup:\s*z\.boolean\(\)/);
      expect(src).toMatch(/default_story_id:\s*z\.string\(\)\.uuid\(\)\.nullable\(\)/);
    });

    test('barrel exports both hooks', () => {
      const src = readFileSync(resolve(ROOT, 'src/hooks/index.ts'), 'utf-8');
      expect(src).toMatch(/usePlatformWarmupState/);
      expect(src).toMatch(/useMarkWarmupStep/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Wizard component + route + auto-redirect', () => {
    test('wizard file exists', () => {
      expect(existsSync(WIZARD)).toBe(true);
    });

    test('wizard renders all 5 steps as conditional blocks', () => {
      const src = readFileSync(WIZARD, 'utf-8');
      for (const step of ['welcome', 'kb_upload', 'rules_setup', 'test_query', 'complete']) {
        expect(src, `step ${step} branch missing`).toMatch(new RegExp(`activeStep === "${step}"`));
      }
    });

    test('wizard reuses StoryKnowledgeTab (no new admin tooling for KB upload)', () => {
      const src = readFileSync(WIZARD, 'utf-8');
      expect(src).toMatch(/import \{ StoryKnowledgeTab \}/);
      expect(src).toMatch(/<StoryKnowledgeTab storyId=\{state\.default_story_id\}/);
    });

    test('wizard links to existing /admin/context-profiles for rules_setup step', () => {
      const src = readFileSync(WIZARD, 'utf-8');
      // No new admin tooling — link to the existing surface.
      expect(src).toMatch(/to="\/admin\/context-profiles"/);
    });

    test('wizard gates kb_upload completion on default_story_kb_count threshold', () => {
      const src = readFileSync(WIZARD, 'utf-8');
      expect(src).toMatch(/state\.default_story_kb_count\s*<\s*MIN_KB_FOR_KB_UPLOAD/);
    });

    test('all user-facing strings go through t("warmup.*")', () => {
      const src = readFileSync(WIZARD, 'utf-8');
      expect(src).toMatch(/t\("warmup\.title"\)/);
      expect(src).toMatch(/t\("warmup\.steps\.welcome\.headline"\)/);
      expect(src).toMatch(/t\("warmup\.steps\.complete\.cta"\)/);
    });

    test('wizard has admin/staff permission gate', () => {
      const src = readFileSync(WIZARD, 'utf-8');
      expect(src).toMatch(/hasPermission\("view_admin_panel"\)/);
    });

    test('router registers /admin/warmup route + lazy-loads the component', () => {
      const src = readFileSync(ROUTER, 'utf-8');
      expect(src).toMatch(/lazy\(\(\) => import\("\.\/pages\/admin\/AdminWarmupWizard"\)\)/);
      expect(src).toMatch(/<Route path="warmup" element=\{<AdminWarmupWizard \/>\}/);
    });

    test('AdminOverview auto-redirects to /admin/warmup when needs_warmup', () => {
      const src = readFileSync(OVERVIEW, 'utf-8');
      expect(src).toMatch(/usePlatformWarmupState/);
      expect(src).toMatch(/<Navigate to="\/admin\/warmup" replace/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('i18n: all 6 locales declare warmup.* keys', () => {
    const REQUIRED_TOP_KEYS = ['title', 'subtitle', 'statusDone', 'stepperAria', 'progressLabel', 'stepMarkedError'];
    const REQUIRED_STEPS = ['welcome', 'kb_upload', 'rules_setup', 'test_query', 'complete'];

    for (const locale of LOCALES) {
      test(`${locale}/warmup.json: file exists + canonical shape`, () => {
        const segPath = resolve(ROOT, `src/i18n/segments/${locale}/warmup.json`);
        expect(existsSync(segPath), `${locale}/warmup.json missing`).toBe(true);
        const seg = JSON.parse(readFileSync(segPath, 'utf-8')) as Record<string, unknown>;
        const warmup = seg.warmup as Record<string, unknown> | undefined;
        expect(warmup, `${locale} missing warmup namespace`).toBeTruthy();
        for (const key of REQUIRED_TOP_KEYS) {
          expect(typeof warmup?.[key], `${locale} missing warmup.${key}`).toBe('string');
        }
        const steps = warmup?.steps as Record<string, Record<string, string>> | undefined;
        expect(steps, `${locale} missing warmup.steps`).toBeTruthy();
        for (const step of REQUIRED_STEPS) {
          expect(steps?.[step], `${locale} missing warmup.steps.${step}`).toBeTruthy();
          expect(typeof steps?.[step]?.title).toBe('string');
          expect(typeof steps?.[step]?.cta).toBe('string');
        }
      });

      test(`${locale}: non-EN values are not EN-fallback copies`, () => {
        if (locale === 'en') return;
        const seg = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/segments/${locale}/warmup.json`), 'utf-8')) as { warmup?: { title?: string; subtitle?: string; steps?: { welcome?: { headline?: string } } } };
        const en  = JSON.parse(readFileSync(resolve(ROOT, 'src/i18n/segments/en/warmup.json'), 'utf-8')) as { warmup?: { title?: string; subtitle?: string; steps?: { welcome?: { headline?: string } } } };
        // The longest, most language-specific strings must differ from EN.
        expect(seg.warmup?.title,    `${locale}.title is EN copy`).not.toBe(en.warmup?.title);
        expect(seg.warmup?.subtitle, `${locale}.subtitle is EN copy`).not.toBe(en.warmup?.subtitle);
        expect(seg.warmup?.steps?.welcome?.headline, `${locale}.welcome.headline is EN copy`).not.toBe(en.warmup?.steps?.welcome?.headline);
      });
    }
  });
});
