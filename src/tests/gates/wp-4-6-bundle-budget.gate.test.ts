/**
 * Gate test: Phase 12 WP 4.6 — Vite bundle size audit + budget gate.
 *
 * Enforces:
 *   1. Audit script exists with shebang + supports --json + --strict + --update-baseline
 *   2. Baseline file exists with current chunk sizes captured
 *   3. Hard budgets defined per category (initial 150kB, lazy 250kB, vendor 500kB)
 *
 * The "current vs baseline" comparison only runs when dist/ exists (i.e.
 * after npm run build). This gate is structural — it verifies the tooling
 * is in place. The actual size-regression check runs in the CI pipeline
 * after build completes.
 *
 * Ratchet semantics (same as WP 2.5 staleTime):
 *   - Violations (over budget) reported but DON'T fail — existing debt
 *   - Regressions (>5 % growth vs baseline) DO fail — no slipping
 *   - `--strict` flag escalates violations to failures (target future state)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts/audit/bundle-budget.mjs');
const BASELINE = path.join(
  ROOT,
  'src/tests/gates/wp-4-6-bundle-budget.baseline.json',
);

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

describe('Phase 12 WP 4.6 — bundle-budget.mjs script', () => {
  it('script exists at scripts/audit/bundle-budget.mjs', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  it('script has shebang', () => {
    expect(readOrEmpty(SCRIPT).startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('supports --json + --strict + --update-baseline flags', () => {
    const src = readOrEmpty(SCRIPT);
    expect(src).toMatch(/--json/);
    expect(src).toMatch(/--strict/);
    expect(src).toMatch(/--update-baseline/);
  });

  it('defines per-category budgets (initial / lazy / vendor)', () => {
    const src = readOrEmpty(SCRIPT);
    expect(src).toMatch(/initial:\s*150\s*\*\s*1024/);
    expect(src).toMatch(/lazy:\s*250\s*\*\s*1024/);
    expect(src).toMatch(/vendor:\s*500\s*\*\s*1024/);
  });

  it('uses node:zlib gzipSync (no extra npm dep)', () => {
    expect(readOrEmpty(SCRIPT)).toMatch(/from\s+['"]node:zlib['"]/);
    expect(readOrEmpty(SCRIPT)).toMatch(/gzipSync/);
  });

  it('does NOT shell out (no child_process)', () => {
    expect(readOrEmpty(SCRIPT)).not.toMatch(/from\s+['"]node:child_process['"]/);
  });
});

describe('Phase 12 WP 4.6 — baseline file', () => {
  it('baseline JSON exists', () => {
    expect(fs.existsSync(BASELINE), 'run `npm run build && node scripts/audit/bundle-budget.mjs --update-baseline`').toBe(true);
  });

  it('baseline contains summary + chunks map', () => {
    const parsed = JSON.parse(readOrEmpty(BASELINE)) as {
      summary?: { total_chunks?: number; total_gzip_bytes?: number };
      chunks?: Record<string, { gzipBytes: number; rawBytes: number; category: string }>;
    };
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary?.total_chunks).toBeGreaterThan(0);
    expect(parsed.summary?.total_gzip_bytes).toBeGreaterThan(0);
    expect(parsed.chunks).toBeDefined();
    expect(Object.keys(parsed.chunks ?? {}).length).toBeGreaterThan(0);
  });

  it('baseline chunks each have gzipBytes + rawBytes + category', () => {
    const parsed = JSON.parse(readOrEmpty(BASELINE)) as {
      chunks?: Record<string, { gzipBytes: number; rawBytes: number; category: string }>;
    };
    for (const [name, chunk] of Object.entries(parsed.chunks ?? {})) {
      expect(typeof chunk.gzipBytes, name).toBe('number');
      expect(typeof chunk.rawBytes, name).toBe('number');
      expect(['initial', 'lazy', 'vendor']).toContain(chunk.category);
    }
  });
});

describe('Phase 12 WP 4.6 — gate evolution', () => {
  it('script implements ratchet-down (no-regression) semantics', () => {
    const src = readOrEmpty(SCRIPT);
    expect(src).toMatch(/regressions/);
    expect(src).toMatch(/1\.05|5\s*%|tolerance/i);
  });

  it('script can be flipped to strict (target future state)', () => {
    expect(readOrEmpty(SCRIPT)).toMatch(/--strict/);
  });
});
