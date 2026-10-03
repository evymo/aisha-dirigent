/**
 * Frontend typecheck baseline gate — monotone-decreasing strict-mode debt
 *
 * Same pattern as service-typecheck-baseline.gate.test.ts but for the
 * frontend React/Vite app at repo root. Snapshots the current count of
 * strict-mode (noImplicitAny + strictNullChecks) violations from
 * `tsc -p tsconfig.strict.json` and prevents any PR from growing it.
 *
 * Why a separate strict config: enabling noImplicitAny + strictNullChecks
 * directly in tsconfig.app.json (the Vite build config) would break
 * `npm run build` today (~925 legacy violations). The strict config is
 * read-only for the gate / generator, build keeps using app.json.
 *
 * Long-term: each PR that touches a frontend hook / component fixes a
 * chunk of strict errors there + regenerates the baseline lower. When
 * baseline hits 0, the strict settings can be folded back into
 * tsconfig.app.json and this layer becomes redundant.
 *
 * To regenerate baseline (after fixing errors):
 *   npm run gen:frontend-typecheck:baseline
 *
 * To run drift check (what CI does):
 *   npm run gen:frontend-typecheck:check
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE_FILE = resolve(ROOT, 'src/tests/gates/frontend-typecheck-baseline.json');
const STRICT_CONFIG = resolve(ROOT, 'tsconfig.strict.json');
const GENERATOR = resolve(ROOT, 'scripts/gen-frontend-typecheck-baseline.mjs');

interface Baseline {
  generated_at: string;
  total: number;
  by_code: Record<string, number>;
  file_count: number;
}

describe('Frontend typecheck baseline gate', () => {
  test('strict tsconfig exists with noImplicitAny + strictNullChecks', () => {
    expect(existsSync(STRICT_CONFIG)).toBe(true);
    const content = readFileSync(STRICT_CONFIG, 'utf-8');
    expect(content).toMatch(/"noImplicitAny"\s*:\s*true/);
    expect(content).toMatch(/"strictNullChecks"\s*:\s*true/);
    expect(content).toMatch(/"extends"\s*:\s*"\.\/tsconfig\.app\.json"/);
  });

  test('baseline file exists', () => {
    expect(existsSync(BASELINE_FILE)).toBe(true);
  });

  test('generator script exists', () => {
    expect(existsSync(GENERATOR)).toBe(true);
  });

  test('baseline has well-formed JSON with total + by_code', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    expect(baseline.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(baseline.total).toBeTypeOf('number');
    expect(baseline.total).toBeGreaterThanOrEqual(0);
    expect(baseline.by_code).toBeTypeOf('object');
  });

  test('baseline total is finite + tracked (sanity bound)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    // Snapshot bound — current count is ~925. Anything above 1500 means
    // either the gate is regenerated wrong OR a massive regression. Either
    // way: stop the line and audit.
    expect(baseline.total).toBeLessThan(1500);
  });

  test('npm scripts gen:frontend-typecheck are wired', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['gen:frontend-typecheck:baseline']).toBeDefined();
    expect(pkg.scripts?.['gen:frontend-typecheck:check']).toBeDefined();
  });

  test('progress reminder: ratchets DOWN over time (informational)', () => {
    // Not enforced — passes always. Surfaces the current count in test
    // output as a visible reminder that this is technical debt to be paid
    // down, not a permanent waiver. Actual ratcheting is in CI step
    // `npm run gen:frontend-typecheck:check` which fails on growth.
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as Baseline;
    expect(
      baseline.total,
      `Frontend strict-mode debt: ${baseline.total} errors across ${baseline.file_count} files. ` +
        `Top categories: ${Object.entries(baseline.by_code)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([code, n]) => `${code} (${n})`)
          .join(', ')}. ` +
        `Each PR that touches a frontend file should fix at least one error in it.`,
    ).toBeGreaterThanOrEqual(0);
  });
});
