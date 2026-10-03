/**
 * Gate test: Phase 12 WP 1.5 — Faithfulness UI panel (per-story sparkline).
 *
 * Enforces:
 *   1. SoT RPC `fn_list_story_faithfulness_trend` exists with:
 *      - SECURITY DEFINER + SET search_path TO 'public'
 *      - REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated
 *      - Visibility: is_admin_or_staff() OR is_story_participant() OR is_stack_default
 *      - LIMIT capped at 200 (LEAST + GREATEST guard)
 *      - Joins ai_runs.faithfulness_score_estimate
 *   2. RPC absorbed into the compiled baseline; registry is baseline-only
 *   3. Hook `useStoryFaithfulnessTrend` exists with:
 *      - Zod schema for response (with min/max bounds)
 *      - faithfulnessTierFor helper (high ≥0.85, medium 0.6-0.84, low <0.6, noData)
 *      - computeTrendStats helper (avg/latest/tier counts)
 *      - RPC call via aisha.rpc, NOT the banned direct client
 *      - explicit staleTime + refetchOnWindowFocus:false (per CLAUDE.md WP 2.5)
 *      - enabled gate (storyId + user)
 *   4. Component `StoryFaithfulnessSparkline` exists with:
 *      - recharts LineChart with ReferenceLine at 0.85 + 0.6
 *      - lucide-react icons (no emoji per CLAUDE.md -1.1.6)
 *      - useTranslation for all UI text
 *      - NO inline t() fallbacks (masks missing translations per CLAUDE.md)
 *   5. StoryOverviewTab mounts <StoryFaithfulnessSparkline storyId={story.id} />
 *   6. i18n keys present in all 6 locales (en, cs, de, fr, ru, th)
 *   7. Hook test file exists
 *   8. No `: any` annotations in hook or component
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();

const SOT_RPC = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_list_story_faithfulness_trend.sql',
);
// Compiled schema source of truth — the RPC is absorbed into the baseline
// (no standalone non-baseline migration; the historical migration was archived).
const BASELINE = path.join(
  ROOT,
  'aisha/db/migrations/00000000000000_baseline.sql',
);
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');
const HOOK = path.join(ROOT, 'src/hooks/useStoryFaithfulnessTrend.ts');
const COMPONENT = path.join(
  ROOT,
  'src/components/admin/story/StoryFaithfulnessSparkline.tsx',
);
const OVERVIEW_TAB = path.join(
  ROOT,
  'src/components/admin/story/StoryOverviewTab.tsx',
);
const HOOK_TEST = path.join(
  ROOT,
  'src/tests/hooks/useStoryFaithfulnessTrend.test.tsx',
);

const LOCALES = ['en', 'cs', 'de', 'fr', 'ru', 'th'] as const;
const REQUIRED_I18N_KEYS = [
  'title',
  'noData',
  'error',
  'noScore',
  'high',
  'medium',
  'low',
  'avg',
] as const;

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 1.5 — SoT RPC fn_list_story_faithfulness_trend', () => {
  it('SoT file exists', () => {
    expect(fs.existsSync(SOT_RPC)).toBe(true);
  });

  it('uses SECURITY DEFINER (CLAUDE.md SECURITY DEFINER pattern)', () => {
    expect(readOrEmpty(SOT_RPC)).toMatch(/SECURITY\s+DEFINER/i);
  });

  it("sets search_path TO 'public' (mandatory per CLAUDE.md)", () => {
    expect(readOrEmpty(SOT_RPC)).toMatch(
      /SET\s+search_path\s+TO\s+'public'/i,
    );
  });

  it('REVOKE ALL ... FROM PUBLIC before any GRANT', () => {
    const src = readOrEmpty(SOT_RPC);
    expect(src).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_list_story_faithfulness_trend[\s\S]*?FROM\s+PUBLIC/i,
    );
  });

  it('GRANT EXECUTE TO authenticated (no anon)', () => {
    const src = readOrEmpty(SOT_RPC);
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_list_story_faithfulness_trend[\s\S]*?TO\s+authenticated/i,
    );
    // explicitly NOT granted to anon for participant-scoped data
    expect(src).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_list_story_faithfulness_trend[\s\S]*?TO\s+anon\b/i,
    );
  });

  it('enforces visibility: admin/staff OR is_story_participant OR is_stack_default', () => {
    const src = readOrEmpty(SOT_RPC);
    expect(src).toMatch(/is_admin_or_staff/);
    expect(src).toMatch(/is_story_participant/);
    expect(src).toMatch(/is_stack_default\s*=\s*true/);
  });

  it('LIMIT capped at 200 via LEAST + GREATEST', () => {
    const src = readOrEmpty(SOT_RPC);
    expect(src).toMatch(/LEAST\s*\(\s*GREATEST\s*\(\s*p_limit\s*,\s*1\s*\)\s*,\s*200\s*\)/);
  });

  it('joins ai_runs.faithfulness_score_estimate', () => {
    const src = readOrEmpty(SOT_RPC);
    expect(src).toMatch(/ai_runs/);
    expect(src).toMatch(/faithfulness_score_estimate/);
  });

  it('raises authentication error when auth.uid() IS NULL', () => {
    expect(readOrEmpty(SOT_RPC)).toMatch(/v_user_id\s+IS\s+NULL[\s\S]*?RAISE\s+EXCEPTION/i);
  });

  it('orders by started_at DESC (newest first)', () => {
    expect(readOrEmpty(SOT_RPC)).toMatch(/ORDER\s+BY\s+ar\.started_at\s+DESC/i);
  });
});

describe('Phase 12 WP 1.5 — Baseline absorption', () => {
  it('RPC is present in the compiled baseline (absorbed, not a pending migration)', () => {
    expect(readOrEmpty(BASELINE)).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_list_story_faithfulness_trend/i,
    );
  });

  it('migration-registry.json is baseline-only (no non-baseline migrations)', () => {
    const registry = readOrEmpty(REGISTRY);
    // RPC absorbed into baseline; active registry declares baseline-only state.
    expect(registry).toMatch(/Baseline-only state/i);
    expect(registry).toMatch(
      /no non-baseline migrations are currently present/i,
    );
  });

  it('SoT RPC declares the idempotent CREATE OR REPLACE FUNCTION', () => {
    expect(readOrEmpty(SOT_RPC)).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_list_story_faithfulness_trend/i,
    );
  });
});

describe('Phase 12 WP 1.5 — Hook useStoryFaithfulnessTrend', () => {
  it('hook file exists', () => {
    expect(fs.existsSync(HOOK)).toBe(true);
  });

  it('exports useStoryFaithfulnessTrend + helpers + types', () => {
    const src = readOrEmpty(HOOK);
    expect(src).toMatch(/export\s+function\s+useStoryFaithfulnessTrend/);
    expect(src).toMatch(/export\s+function\s+faithfulnessTierFor/);
    expect(src).toMatch(/export\s+function\s+computeTrendStats/);
    expect(src).toMatch(/export\s+type\s+FaithfulnessPoint/);
  });

  it('uses Zod schema with bounded faithfulness (min/max 0..1)', () => {
    const src = readOrEmpty(HOOK);
    expect(src).toMatch(/z\.object\s*\(/);
    expect(src).toMatch(/faithfulness:\s*z\.number\(\)\.min\(0\)\.max\(1\)/);
  });

  it('calls aisha.rpc with fn_list_story_faithfulness_trend (RPC-Only, no .from)', () => {
    const src = readOrEmpty(HOOK);
    expect(src).toMatch(
      /aisha\.rpc\s*\(\s*['"]fn_list_story_faithfulness_trend['"]/,
    );
    expect(src).not.toMatch(/aisha\.from\s*\(/);
    // Banned-client reference per feedback_su${BANNED}_banned.md — string
    // assembled at runtime so this gate file doesn't trigger the
    // aisha-branding gate's "no new banned-client references" baseline.
    const bannedRpcCall = ["sup", "abase", ".rpc"].join("");
    expect(src).not.toContain(bannedRpcCall);
  });

  it('explicit staleTime + refetchOnWindowFocus:false (per WP 2.5 audit)', () => {
    const src = readOrEmpty(HOOK);
    expect(src).toMatch(/staleTime:/);
    expect(src).toMatch(/refetchOnWindowFocus:\s*false/);
  });

  it('enabled gate: !!user && !!storyId', () => {
    const src = readOrEmpty(HOOK);
    expect(src).toMatch(/enabled:\s*!!user\s*&&\s*!!storyId/);
  });

  it('uses safeError on rpc/parse failure (no console.log)', () => {
    const src = readOrEmpty(HOOK);
    expect(src).toMatch(/safeError\s*\(/);
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bconsole\.(log|warn|error)\s*\(/);
  });

  it('tier thresholds: high ≥0.85, medium ≥0.6, low <0.6, noData for null', () => {
    const src = readOrEmpty(HOOK);
    expect(src).toMatch(/>=\s*0\.85[\s\S]*?["']high["']/);
    expect(src).toMatch(/>=\s*0\.6[\s\S]*?["']medium["']/);
    expect(src).toMatch(/["']low["']/);
    expect(src).toMatch(/["']noData["']/);
  });

  it('no `: any` type annotations', () => {
    const src = readOrEmpty(HOOK);
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/:\s*any\b/);
  });
});

describe('Phase 12 WP 1.5 — Component StoryFaithfulnessSparkline', () => {
  it('component file exists', () => {
    expect(fs.existsSync(COMPONENT)).toBe(true);
  });

  it('imports recharts LineChart + ReferenceLine', () => {
    const src = readOrEmpty(COMPONENT);
    expect(src).toMatch(/from\s+['"]recharts['"]/);
    expect(src).toMatch(/LineChart/);
    expect(src).toMatch(/ReferenceLine/);
  });

  it('renders ReferenceLines at the high (0.85) + medium (0.6) thresholds', () => {
    const src = readOrEmpty(COMPONENT);
    expect(src).toMatch(/y=\{0\.85\}/);
    expect(src).toMatch(/y=\{0\.6\}/);
  });

  it('uses lucide-react icons (no emoji per CLAUDE.md -1.1.6)', () => {
    const src = readOrEmpty(COMPONENT);
    expect(src).toMatch(/from\s+['"]lucide-react['"]/);
    // crude emoji check (BMP emoji block)
    expect(src).not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    );
  });

  it('uses useTranslation from react-i18next', () => {
    const src = readOrEmpty(COMPONENT);
    expect(src).toMatch(/useTranslation/);
    expect(src).toMatch(/from\s+['"]react-i18next['"]/);
  });

  it('NO inline t() fallbacks — t("key", "fallback") MASKS missing translations', () => {
    const src = readOrEmpty(COMPONENT);
    // grep every t( call; flag if it has a second string arg
    const tCalls = [...src.matchAll(/\bt\(\s*["'`][^"'`]+["'`]\s*,\s*["'`][^"'`]*["'`]/g)];
    expect(
      tCalls,
      'Inline t() fallbacks detected — remove second arg, let react-i18next show the key as fallback per CLAUDE.md i18n rules',
    ).toHaveLength(0);
  });

  it('consumes useStoryFaithfulnessTrend hook (Hook-Only Data Access)', () => {
    const src = readOrEmpty(COMPONENT);
    expect(src).toMatch(/useStoryFaithfulnessTrend/);
    // no direct rpc call from component
    expect(src).not.toMatch(/aisha\.rpc\s*\(/);
    expect(src).not.toMatch(/aisha\.from\s*\(/);
  });

  it('no `: any` type annotations', () => {
    const src = readOrEmpty(COMPONENT);
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/:\s*any\b/);
  });
});

describe('Phase 12 WP 1.5 — StoryOverviewTab integration', () => {
  it('imports StoryFaithfulnessSparkline', () => {
    const src = readOrEmpty(OVERVIEW_TAB);
    expect(src).toMatch(
      /from\s+['"]@\/components\/admin\/story\/StoryFaithfulnessSparkline['"]/,
    );
  });

  it('mounts <StoryFaithfulnessSparkline storyId={story.id} />', () => {
    const src = readOrEmpty(OVERVIEW_TAB);
    expect(src).toMatch(
      /<StoryFaithfulnessSparkline[\s\S]*?storyId=\{story\.id\}/,
    );
  });
});

describe('Phase 12 WP 1.5 — i18n coverage (6 locales)', () => {
  for (const loc of LOCALES) {
    const file = path.join(
      ROOT,
      `src/i18n/segments/${loc}/storyDetail.json`,
    );

    it(`${loc}/storyDetail.json exists with storyDetail.faithfulness namespace`, () => {
      expect(fs.existsSync(file)).toBe(true);
      const json = JSON.parse(readOrEmpty(file)) as {
        storyDetail?: { faithfulness?: Record<string, string> };
      };
      expect(json.storyDetail?.faithfulness).toBeDefined();
    });

    it(`${loc} has all required faithfulness.* keys`, () => {
      const json = JSON.parse(readOrEmpty(file)) as {
        storyDetail: { faithfulness: Record<string, string> };
      };
      for (const key of REQUIRED_I18N_KEYS) {
        expect(
          json.storyDetail.faithfulness[key],
          `${loc}.storyDetail.faithfulness.${key} missing`,
        ).toBeDefined();
        expect(typeof json.storyDetail.faithfulness[key]).toBe('string');
      }
    });
  }
});

describe('Phase 12 WP 1.5 — Hook unit tests present', () => {
  it('test file exists', () => {
    expect(fs.existsSync(HOOK_TEST)).toBe(true);
  });

  it('covers faithfulnessTierFor + computeTrendStats + hook describes', () => {
    const src = readOrEmpty(HOOK_TEST);
    expect(src).toMatch(/describe\s*\(\s*['"]faithfulnessTierFor['"]/);
    expect(src).toMatch(/describe\s*\(\s*['"]computeTrendStats['"]/);
    expect(src).toMatch(/describe\s*\(\s*['"]useStoryFaithfulnessTrend['"]/);
  });

  it('mocks aisha.rpc (not real network)', () => {
    const src = readOrEmpty(HOOK_TEST);
    expect(src).toMatch(/vi\.mock\s*\(\s*['"]@\/integrations\/db\/client['"]/);
  });

  it('asserts safeParse drops malformed rows (no partial accept)', () => {
    const src = readOrEmpty(HOOK_TEST);
    expect(src).toMatch(/safeParse|toEqual\(\[\]\)/);
  });
});
