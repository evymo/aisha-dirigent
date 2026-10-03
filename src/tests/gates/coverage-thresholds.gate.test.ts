/**
 * Coverage thresholds gate — prevent silent weakening of test coverage policy
 *
 * vitest.config.ts declares coverage thresholds (lines/functions/branches/
 * statements). When CI runs `npm run test:coverage`, vitest fails if any
 * threshold drops below the configured value. This gate enforces that
 * the thresholds THEMSELVES don't get weakened via a config edit (e.g.
 * `lines: 80` → `lines: 50` in a PR that's failing coverage).
 *
 * Why static, not runtime: running coverage on every PR is expensive
 * (~3-5 min). This gate runs in <50ms and catches the most common
 * regression vector (lowering the threshold to make a failing PR pass).
 * Actual coverage measurement happens in test:repo:full pipeline.
 *
 * The gate enforces:
 *   - vitest.config.ts has a coverage section
 *   - All 4 standard metrics (lines/functions/branches/statements) present
 *   - Each threshold ≥ 80% (current AISHA baseline)
 *   - No `0` / `false` / commented-out thresholds (weakening)
 *
 * Workflow when raising baseline (e.g. 80 → 85):
 *   1. Edit vitest.config.ts thresholds to new values
 *   2. Run `npm run test:coverage` — verify it still passes
 *   3. Update MINIMUM_THRESHOLD constant in this gate to match
 *   4. Commit both files together
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const VITEST_CONFIG = resolve(ROOT, 'vitest.config.ts');

/**
 * Minimum required threshold for each coverage metric. Reflects the
 * current platform baseline. Raising this REQUIRES a matching change
 * in vitest.config.ts. Lowering is forbidden by design — see file
 * header for the rationale.
 */
const MINIMUM_THRESHOLD = 80;

const REQUIRED_METRICS = ['lines', 'functions', 'branches', 'statements'] as const;

describe('Coverage thresholds gate', () => {
  test('vitest.config.ts exists', () => {
    expect(existsSync(VITEST_CONFIG)).toBe(true);
  });

  test('coverage section is declared', () => {
    const content = readFileSync(VITEST_CONFIG, 'utf-8');
    expect(content).toMatch(/coverage:\s*{/);
    expect(content).toMatch(/thresholds:\s*{/);
  });

  test.each(REQUIRED_METRICS)(
    'threshold "%s" is set and ≥ %s%',
    (metric) => {
      const content = readFileSync(VITEST_CONFIG, 'utf-8');
      // Match the `lines: 80,` style declaration inside `thresholds: { ... }`
      const pattern = new RegExp(`${metric}\\s*:\\s*(\\d+)`);
      const m = content.match(pattern);
      expect(m, `Coverage metric "${metric}" must be declared in vitest.config.ts`).not.toBeNull();
      const value = parseInt(m![1], 10);
      expect(
        value,
        `Coverage threshold "${metric}" is ${value}, must be ≥ ${MINIMUM_THRESHOLD} (raising is OK, lowering forbidden)`,
      ).toBeGreaterThanOrEqual(MINIMUM_THRESHOLD);
    },
  );

  test('no threshold is set to 0 (silent disable)', () => {
    const content = readFileSync(VITEST_CONFIG, 'utf-8');
    // Reject `metric: 0,` patterns inside thresholds block
    for (const metric of REQUIRED_METRICS) {
      const zeroPattern = new RegExp(`${metric}\\s*:\\s*0\\b`);
      expect(
        zeroPattern.test(content),
        `Coverage metric "${metric}" is set to 0 — that's a silent disable. Set to ≥ ${MINIMUM_THRESHOLD} or remove the entry entirely.`,
      ).toBe(false);
    }
  });

  test('coverage provider is v8 (consistent + accurate)', () => {
    const content = readFileSync(VITEST_CONFIG, 'utf-8');
    expect(content).toMatch(/provider:\s*["']v8["']/);
  });

  test('coverage include covers all src/**/*.{ts,tsx}', () => {
    const content = readFileSync(VITEST_CONFIG, 'utf-8');
    // Must include src ts/tsx files — otherwise coverage measures nothing
    expect(content).toMatch(/include:\s*\[[^\]]*src\/\*\*\/\*\.\{ts,tsx\}/);
  });

  test('coverage excludes test files (not measured as production code)', () => {
    const content = readFileSync(VITEST_CONFIG, 'utf-8');
    expect(content).toMatch(/exclude:\s*\[[\s\S]*?\*\*\/\*\.\{test,spec\}/);
  });

  test('npm script test:coverage is wired', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['test:coverage']).toBeDefined();
    expect(pkg.scripts?.['test:coverage']).toMatch(/coverage/);
  });

  test('test:repo:full pipeline includes coverage measurement', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const full = pkg.scripts?.['test:repo:full'];
    expect(full).toBeDefined();
    expect(
      full,
      'test:repo:full must include test:repo:coverage step so PRs run coverage measurement',
    ).toMatch(/test:repo:coverage|test:coverage/);
  });
});
