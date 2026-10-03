/**
 * Gate test: Phase 12 WP 0.5 — baseline capture script + snapshot doc.
 *
 * Enforces:
 *   1. Script `scripts/observability/capture-baseline.mjs` exists and is
 *      executable-shaped (shebang + .mjs).
 *   2. Initial baseline doc + JSON for the current canonical date
 *      (BASELINE_2026-05-20.md + baseline-2026-05-20.json) committed.
 *   3. JSON contains all 12 KPI placeholder keys per Phase 12 §0.4.
 *   4. Script reads from Langfuse + Prometheus (no Tempo per §-1.12 R1),
 *      no shell-out (no child_process exec/execSync calls in script).
 *   5. Script is safe: no AISHA_DB_URL or other secret in committed source.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SCRIPT_PATH = path.join(
  ROOT,
  'scripts/observability/capture-baseline.mjs',
);
const PERF_DIR = path.join(ROOT, 'docs/perf');
const CANONICAL_DATE = '2026-05-20';
const BASELINE_MD = path.join(PERF_DIR, `BASELINE_${CANONICAL_DATE}.md`);
const BASELINE_JSON = path.join(PERF_DIR, `baseline-${CANONICAL_DATE}.json`);

const REQUIRED_KPI_KEYS: ReadonlyArray<string> = [
  'ttft_p95_ms',
  'total_latency_p95_ms',
  'postgres_rpc_p95_ms',
  'embedding_p95_ms',
  'retrieval_p95_ms',
  'cache_hit_ratio_pct',
  'llm_tokens_per_second',
  'service_count',
  'aitg_gate_pass_ratio',
  'rag_faithfulness_evidence_strict',
  'data_egress_llm_pct',
  'critical_cves_open',
];

describe('Phase 12 WP 0.5 — capture-baseline.mjs script', () => {
  it('script exists at scripts/observability/capture-baseline.mjs', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('script has shebang for Node.js execution', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('script queries Langfuse trace API (not Tempo per §-1.12 R1)', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toContain('LANGFUSE_HOST');
    expect(src).toContain('/api/public/traces');
    expect(src).not.toMatch(/tempo:[0-9]/);
    expect(src).not.toMatch(/\/api\/traces.*tempo/);
  });

  it('script queries Prometheus for metrics', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toContain('PROMETHEUS_URL');
    expect(src).toContain('histogram_quantile');
  });

  it('script does NOT shell out (no child_process exec usage)', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // No execSync / spawn with shell, no shell-style execFile templating
    expect(src).not.toMatch(/execSync\s*\(/);
    expect(src).not.toMatch(/from\s+['"]node:child_process['"]/);
    expect(src).not.toMatch(/require\s*\(\s*['"]child_process['"]\s*\)/);
  });

  it('script does NOT contain inline secrets / production URLs', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).not.toMatch(/https?:\/\/[^\s'"`]*\.aisha\.guru/);
    expect(src).not.toMatch(/https?:\/\/[^\s'"`]*\.backend\.id3a\.cz/);
    expect(src).not.toMatch(/['"]eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./);
    expect(src).not.toMatch(/postgres:\/\/[^:]+:[^@]+@/);
  });

  it('script defaults exporter URLs to in-cluster service names', () => {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toMatch(/langfuse-server:3000/);
    expect(src).toMatch(/prometheus:9090/);
  });
});

describe('Phase 12 WP 0.5 — initial baseline snapshot', () => {
  it(`BASELINE_${CANONICAL_DATE}.md exists`, () => {
    expect(fs.existsSync(BASELINE_MD)).toBe(true);
  });

  it(`baseline-${CANONICAL_DATE}.json exists with valid JSON`, () => {
    expect(fs.existsSync(BASELINE_JSON)).toBe(true);
    const raw = fs.readFileSync(BASELINE_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toBeTypeOf('object');
  });

  it.each(REQUIRED_KPI_KEYS)('baseline JSON has KPI key `%s`', (key) => {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf8'));
    expect(parsed.kpis).toBeDefined();
    expect(parsed.kpis).toHaveProperty(key);
  });

  it('baseline JSON has `meta.baseline_date` matching canonical date', () => {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf8'));
    expect(parsed.meta?.baseline_date).toBe(CANONICAL_DATE);
  });

  it('baseline JSON does NOT include sensitive credentials', () => {
    const raw = fs.readFileSync(BASELINE_JSON, 'utf8');
    // Detect inline JWTs, Postgres URLs with creds, Bearer tokens
    expect(raw).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./);
    expect(raw).not.toMatch(/postgres:\/\/[^:]+:[^@]+@/);
    expect(raw).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{20,}/);
  });

  it('baseline MD references the canonical capture procedure', () => {
    const md = fs.readFileSync(BASELINE_MD, 'utf8');
    expect(md).toContain('Capture procedure');
    expect(md).toContain('capture-baseline.mjs');
    expect(md).toContain('rag_eval_runs');
  });
});
