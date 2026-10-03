/**
 * Gate test: Phase 12 WP 4.3 — bge-reranker as 3rd vLLM profile.
 *
 * Enforces:
 *   1. docker-compose.local.yml has vllm-reranker service
 *   2. Reranker uses bge-reranker-v2-m3 + --task=score (NOT chat)
 *   3. GPU budget audit holds (sum of all 3 vllm utilisations ≤ 0.95)
 *   4. Reranker SHARES the vllm-models volume (no redundant download)
 *   5. context_profiles.rerank_provider column declared with CHECK enum
 *   6. Migration registered + seeds bge_reranker_local + cohere_rerank
 *      provider rows
 *   7. Cohere registered as DISABLED by default (premium-only)
 *   8. Runbook exists with rollout sequence + rollback + GPU budget
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const COMPOSE = path.join(ROOT, 'docker-compose.local.yml');
const CONTEXT_PROFILES_SOT = path.join(
  ROOT,
  'aisha/db/sql/tables/context_profiles.sql',
);
// Rerank providers now live in canonical SoT (core provider catalog seed), NOT
// in the archived migration. Gates read current SoT only.
const PROVIDER_SEED = path.join(ROOT, 'aisha/db/seed/core/19_ai_provider_catalog.sql');
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');
const RUNBOOK = path.join(ROOT, 'docs/perf/VLLM_RERANKER_RUNBOOK.md');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/** Extract a single service block from compose YAML. Stops at next 2-space
    service header OR section divider (per WP 2.2 gate experience). */
function extractServiceBlock(yaml: string, serviceName: string): string {
  const startIdx = yaml.indexOf(`${serviceName}:`);
  if (startIdx === -1) return '';
  const tail = yaml.slice(startIdx);
  const sectionDivider = tail.slice(1).match(/\n {2}# -{3,}/);
  const nextSvc = tail.slice(1).match(/\n {2}[A-Za-z][\w-]*:\n/);
  const volumesBlock = tail.match(/\nvolumes:\n/);
  const candidates = [
    sectionDivider ? sectionDivider.index! + 1 : Infinity,
    nextSvc ? nextSvc.index! + 1 : Infinity,
    volumesBlock ? volumesBlock.index! : Infinity,
  ];
  return tail.slice(0, Math.min(...candidates, tail.length));
}

describe('Phase 12 WP 4.3 — vllm-reranker compose service', () => {
  const compose = readText(COMPOSE);
  const block = extractServiceBlock(compose, 'vllm-reranker');

  it('docker-compose.local.yml exists', () => {
    expect(compose.length).toBeGreaterThan(0);
  });

  it('vllm-reranker service is declared', () => {
    expect(block).toMatch(/vllm-reranker:/);
  });

  it('uses BAAI/bge-reranker-v2-m3 model', () => {
    expect(block).toMatch(/--model=BAAI\/bge-reranker-v2-m3/);
  });

  it('runs in score mode (NOT chat — bge-reranker is a cross-encoder)', () => {
    expect(block).toMatch(/--task=score/);
    expect(block).not.toMatch(/--task=(chat|completion|generate)/);
  });

  it('opts in via vllm profile (same as embedding + generation)', () => {
    expect(block).toMatch(/profiles:\s*\[\s*['"]vllm['"]\s*\]/);
  });

  it('gpu-memory-utilization=0.15 (per runbook GPU budget audit)', () => {
    expect(block).toMatch(/--gpu-memory-utilization=0\.15/);
  });

  it('shares the vllm-models volume (no duplicate model cache)', () => {
    expect(block).toMatch(/- vllm-models:\/root\/\.cache\/huggingface/);
  });

  it('exposes port 8124 host → 8000 container', () => {
    expect(block).toMatch(/-\s*['"]8124:8000['"]/);
  });

  it('has a healthcheck pointing at /v1/models', () => {
    expect(block).toMatch(/healthcheck:/);
    expect(block).toMatch(/curl[^\n]*\/v1\/models/);
  });
});

describe('Phase 12 WP 4.3 — GPU budget sum ≤ 0.95', () => {
  const compose = readText(COMPOSE);

  function extractGpuUtil(serviceName: string): number {
    const blk = extractServiceBlock(compose, serviceName);
    const m = blk.match(/--gpu-memory-utilization=([\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  }

  it('vllm-generation + vllm-embedding + vllm-reranker sum ≤ 0.95', () => {
    const gen = extractGpuUtil('vllm-generation');
    const emb = extractGpuUtil('vllm-embedding');
    const rerank = extractGpuUtil('vllm-reranker');
    const total = gen + emb + rerank;
    expect(
      total,
      `GPU budget exceeded: generation=${gen} + embedding=${emb} + reranker=${rerank} = ${total} > 0.95`,
    ).toBeLessThanOrEqual(0.95);
  });
});

describe('Phase 12 WP 4.3 — context_profiles.rerank_provider', () => {
  const sot = readText(CONTEXT_PROFILES_SOT);

  it('rerank_provider column declared', () => {
    expect(sot).toMatch(/rerank_provider\s+text/);
  });

  it('CHECK constraint enumerates all 3 valid providers', () => {
    expect(sot).toMatch(/vllm_local/);
    expect(sot).toMatch(/cohere/);
    expect(sot).toMatch(/capability_resolver/);
  });

  it('column is nullable (default behaviour = no rerank)', () => {
    // Match the CHECK constraint pattern with IS NULL OR ...
    expect(sot).toMatch(
      /rerank_provider IS NULL OR rerank_provider IN/i,
    );
  });
});

describe('Phase 12 WP 4.3 — schema + seed (canonical SoT)', () => {
  // Reranker providers + the rerank_provider column moved from the (now
  // archived) migration into canonical SoT: the column lives in the
  // context_profiles table SoT, the provider rows in the core seed. Gates
  // read current SoT only — never archive/.
  const seed = readText(PROVIDER_SEED);
  const profilesSot = readText(CONTEXT_PROFILES_SOT);

  it('provider catalog seed exists in canonical SoT', () => {
    expect(seed.length).toBeGreaterThan(0);
  });

  it('rerank migration absorbed into baseline (not pending in the registry)', () => {
    // Pin the PROPERTY (the rerank migration specifically is absorbed), not the
    // literal "Baseline-only state" wording — that spelling-level assertion
    // forbade ANY pending migration forever and broke the first time a new,
    // unrelated migration was legitimately registered (2026-07-25).
    const registry = JSON.parse(readText(REGISTRY)) as { migrations?: string[] };
    const pendingRerank = (registry.migrations ?? []).filter((m) => /rerank|bge/i.test(m));
    expect(pendingRerank).toEqual([]);
  });

  it('context_profiles.rerank_provider column declared in table SoT', () => {
    expect(profilesSot).toMatch(/rerank_provider\s+text/);
  });

  it('seeds bge_reranker_local provider row', () => {
    expect(seed).toMatch(/'bge_reranker_local'/);
    expect(seed).toMatch(/local_vllm/);
    expect(seed).toMatch(/vllm-reranker:8000/);
  });

  it('seeds cohere_rerank provider row as DISABLED by default', () => {
    expect(seed).toMatch(/'cohere_rerank'/);
    // Locate the cohere VALUES tuple (the rerank INSERT block); the seed has
    // multiple INSERT blocks, so match the cohere tuple directly up to its
    // cost_class. is_enabled=false must precede cost_class='premium'.
    const cohereRow = seed.match(/'cohere_rerank'[\s\S]*?'premium'/);
    expect(cohereRow, 'cohere_rerank VALUES tuple not found').not.toBeNull();
    expect(cohereRow![0]).toMatch(/false,[\s\S]*?'premium'/);
  });

  it('rerank providers use ON CONFLICT DO NOTHING for idempotent re-seed', () => {
    expect(seed).toMatch(/ON\s+CONFLICT\s*\(\s*slug\s*\)\s+DO\s+NOTHING/i);
  });
});

describe('Phase 12 WP 4.3 — runbook', () => {
  const runbook = readText(RUNBOOK);

  it('VLLM_RERANKER_RUNBOOK.md exists', () => {
    expect(runbook.length).toBeGreaterThan(0);
  });

  it('documents GPU budget audit (gen + emb + reranker)', () => {
    expect(runbook).toMatch(/GPU budget/i);
    expect(runbook).toMatch(/0\.70/);
    expect(runbook).toMatch(/0\.10/);
    expect(runbook).toMatch(/0\.15/);
  });

  it('documents per-profile canary rollout (operator action)', () => {
    expect(runbook).toMatch(/canary|pilot/i);
    expect(runbook).toMatch(/evidence_strict/);
    expect(runbook).toMatch(/UPDATE\s+context_profiles\s+SET\s+rerank_provider/i);
  });

  it('documents 4 rollback levels (profile/provider/compose/schema)', () => {
    expect(runbook).toMatch(/Per-profile/i);
    expect(runbook).toMatch(/Provider-wide/i);
    expect(runbook).toMatch(/Compose-level/i);
    expect(runbook).toMatch(/Schema rollback/i);
  });

  it('compares bge-reranker vs Cohere vs ColBERT explicitly', () => {
    expect(runbook).toMatch(/bge-reranker-v2-m3/i);
    expect(runbook).toMatch(/Cohere/);
    expect(runbook).toMatch(/ColBERT/i);
  });

  it('links related WPs (0.3, 1.6, 2.2, 14.x)', () => {
    expect(runbook).toMatch(/WP 0\.3|WP 1\.6|WP 2\.2|WP 14/);
  });
});
