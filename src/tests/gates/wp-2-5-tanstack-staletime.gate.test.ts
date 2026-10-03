/**
 * Gate test: Phase 12 WP 2.5 — TanStack staleTime audit (ratchet-down).
 *
 * 175 useQuery calls currently lack explicit staleTime (snapshot 2026-05-20).
 * This gate locks that as the baseline and FAILS if the count grows
 * (regression). It ALLOWS the count to drop as hooks are refactored —
 * each PR that adds staleTime should re-run the script and update the
 * baseline. The baseline ratchets DOWN to 0 over time.
 *
 * Enforces:
 *   1. Audit script exists with shebang
 *   2. Script supports --json
 *   3. Total count from script is <= baseline (no regression)
 *   4. Baseline JSON file present
 *   5. Script categorizes by hook filename (lookup, story, admin, live, catalog)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts/audit/tanstack-staletime.mjs');
const BASELINE = path.join(
  ROOT,
  'src/tests/gates/wp-2-5-tanstack-staletime.baseline.json',
);

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 2.5 — TanStack staleTime audit script', () => {
  it('script exists at scripts/audit/tanstack-staletime.mjs', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  it('script has shebang', () => {
    expect(readOrEmpty(SCRIPT).startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('script supports --json output', () => {
    expect(readOrEmpty(SCRIPT)).toMatch(/--json/);
  });

  it('script categorizes by hook filename (5 categories minimum)', () => {
    const src = readOrEmpty(SCRIPT);
    for (const cat of ['live', 'lookup', 'catalog', 'admin', 'story']) {
      expect(src, `script must classify ${cat} category`).toMatch(
        new RegExp(`category:\\s*'${cat}'`),
      );
    }
  });

  it('script always exits 0 (report, not hard fail)', () => {
    // The gate test asserts upper bound separately
    expect(readOrEmpty(SCRIPT)).toMatch(/process\.exit\(0\)/);
  });
});

describe('Phase 12 WP 2.5 — baseline ratchet', () => {
  it('baseline file exists with current count snapshot', () => {
    expect(fs.existsSync(BASELINE)).toBe(true);
    const parsed = JSON.parse(readOrEmpty(BASELINE)) as { total: number };
    expect(typeof parsed.total).toBe('number');
    expect(parsed.total).toBeGreaterThanOrEqual(0);
  });

  it('current count from script is <= baseline (no regression)', () => {
    const baseline = JSON.parse(readOrEmpty(BASELINE)) as { total: number };
    let output = '';
    try {
      output = execFileSync('node', [SCRIPT, '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30_000,
      });
    } catch (err) {
      throw new Error('audit script failed: ' + ((err as Error).message ?? err));
    }
    const current = JSON.parse(output) as { total: number };
    expect(
      current.total,
      `staleTime audit regressed: baseline=${baseline.total}, current=${current.total}. Either refactor newly-introduced hooks to add staleTime, OR (if intentional) regenerate baseline via: node scripts/audit/tanstack-staletime.mjs --json > src/tests/gates/wp-2-5-tanstack-staletime.baseline.json`,
    ).toBeLessThanOrEqual(baseline.total);
  });

  it('baseline ratchets DOWN over time (informational reminder)', () => {
    // Documentation-only assertion. Each Phase 12 WP that lands a staleTime
    // refactor should re-generate the baseline JSON via:
    //   node scripts/audit/tanstack-staletime.mjs --json > src/tests/gates/wp-2-5-tanstack-staletime.baseline.json
    // Target: 0 by end of Phase 12 (90 days).
    expect(true).toBe(true);
  });
});
