/**
 * Gate test: Phase 12 WP 4.5 — React Compiler adoption (decision tracker).
 *
 * The React Compiler ecosystem requires either Babel (regresses HMR ~3×)
 * or the still-pre-alpha SWC variant. This PR ships the DECISION document
 * + baseline of manual-memo usage. Runtime compiler enablement is deferred
 * until SWC variant lands OR ops accepts Babel HMR cost.
 *
 * Enforces:
 *   1. Adoption runbook exists at docs/perf/REACT_COMPILER_ADOPTION.md
 *   2. Runbook documents the 3 paths (wait-for-SWC, Babel, eslint-only)
 *   3. Runbook documents the verification procedure (profiler before/after)
 *   4. Baseline JSON tracks current manual-memo count (ratchet-down target: 0)
 *   5. Current count <= baseline (no regression)
 *
 * Same ratchet-down pattern as WP 2.5 staleTime + WP 4.6 bundle-budget.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const RUNBOOK = path.join(ROOT, 'docs/perf/REACT_COMPILER_ADOPTION.md');
const BASELINE = path.join(
  ROOT,
  'src/tests/gates/wp-4-5-react-compiler.baseline.json',
);

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 4.5 — adoption runbook', () => {
  it('runbook exists', () => {
    expect(fs.existsSync(RUNBOOK)).toBe(true);
  });

  it('documents 3 adoption paths (wait-for-SWC, Babel, eslint-only)', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/Path A.*SWC|wait for SWC/i);
    expect(md).toMatch(/Path B.*Babel|Babel.*HMR/i);
    expect(md).toMatch(/Path C.*eslint|eslint.*plugin/i);
  });

  it('explains why current Vite SWC plugin blocks runtime adoption', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/@vitejs\/plugin-react-swc/);
    expect(md).toMatch(/HMR/);
  });

  it('includes the eslint plugin wiring snippet (paste-ready)', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/eslint-plugin-react-compiler/);
    expect(md).toMatch(/react-compiler\/react-compiler/);
  });

  it('documents the verification procedure (profiler before/after)', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/React DevTools Profiler/);
    expect(md).toMatch(/30.*50.*%|30.*-.*50/);
  });

  it('explicit decision: Path C now, Path A monitor, Path B contingency', () => {
    const md = readOrEmpty(RUNBOOK);
    expect(md).toMatch(/Decision/i);
    expect(md).toMatch(/Path C now/);
  });
});

describe('Phase 12 WP 4.5 — manual-memo baseline ratchet', () => {
  it('baseline file exists with current count snapshot', () => {
    expect(fs.existsSync(BASELINE)).toBe(true);
    const parsed = JSON.parse(readOrEmpty(BASELINE)) as {
      manual_memo_calls: number;
      target: number;
    };
    expect(typeof parsed.manual_memo_calls).toBe('number');
    expect(parsed.target).toBe(0);
  });

  it('current manual-memo count <= baseline (no regression)', () => {
    const baseline = JSON.parse(readOrEmpty(BASELINE)) as {
      manual_memo_calls: number;
    };
    // Run the same grep used to capture baseline
    let output = '';
    try {
      output = execFileSync(
        'bash',
        [
          '-c',
          'grep -rE "useMemo\\(|useCallback\\(" src/ --include="*.tsx" --include="*.ts" | wc -l',
        ],
        { cwd: ROOT, encoding: 'utf8', timeout: 30_000 },
      );
    } catch (err) {
      throw new Error('grep failed: ' + ((err as Error).message ?? err));
    }
    const current = parseInt(output.trim(), 10);
    expect(
      current,
      `manual-memo regressed: baseline=${baseline.manual_memo_calls}, current=${current}. ` +
        `Either remove the new manual memo (React Compiler will handle it), OR ` +
        `regenerate baseline if intentionally added.`,
    ).toBeLessThanOrEqual(baseline.manual_memo_calls);
  });

  it('baseline ratchets DOWN over time (informational)', () => {
    // Each PR that touches a component should drop one or two manual
    // memo calls; baseline regenerates. Target 0 when React Compiler
    // is enabled at runtime (Path A or B).
    expect(true).toBe(true);
  });
});
