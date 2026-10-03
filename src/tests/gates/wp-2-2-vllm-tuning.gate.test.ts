/**
 * Gate test: Phase 12 WP 2.2 — vLLM generation tuning (prefix caching + batch).
 *
 * Enforces docker-compose.local.yml vllm-generation service has:
 *   1. --enable-prefix-caching (Maestro multi-turn TTFT win)
 *   2. --max-num-batched-tokens=8192 (raised from default 4096)
 *   3. --max-num-seqs=256 (explicit, was default)
 *   4. Target model is Qwen3-30B-A3B (the actual MoE model deployed)
 *   5. Documentation runbook exists at docs/perf/VLLM_TUNING_RUNBOOK.md
 *
 * Explicitly asserts spec-decoding NOT enabled here — that's a separate
 * follow-up PR per §3 of the runbook (needs Qwen3 draft model verification
 * + MoE compatibility audit).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const COMPOSE = path.join(ROOT, 'docker-compose.local.yml');
const RUNBOOK = path.join(ROOT, 'docs/perf/VLLM_TUNING_RUNBOOK.md');

function readOrEmpty(p: string): string {
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function extractVllmGenerationBlock(compose: string): string {
  // Find from `vllm-generation:` line to the next top-level service or volumes/networks
  const startIdx = compose.indexOf('vllm-generation:');
  if (startIdx === -1) return '';
  const tail = compose.slice(startIdx);
  // Cut at the next two-space indented service or the volumes/networks/end
  const nextServiceMatch = tail.slice(1).match(/\n {2}\w[\w-]+:\n/);
  const volumesMatch = tail.match(/\nvolumes:\n/);
  const candidateEnds = [
    nextServiceMatch ? nextServiceMatch.index! + 1 : Infinity,
    volumesMatch ? volumesMatch.index! : Infinity,
    tail.length,
  ];
  const endIdx = Math.min(...candidateEnds);
  return tail.slice(0, endIdx);
}

describe('Phase 12 WP 2.2 — vllm-generation perf flags', () => {
  const compose = readOrEmpty(COMPOSE);
  const block = extractVllmGenerationBlock(compose);

  it('docker-compose.local.yml exists', () => {
    expect(compose.length).toBeGreaterThan(0);
  });

  it('vllm-generation service exists', () => {
    expect(block).toMatch(/vllm-generation:/);
  });

  it('targets the actual MoE model in production (Qwen3-30B-A3B)', () => {
    expect(block).toMatch(/--model=Qwen\/Qwen3-30B-A3B/);
  });

  it('--enable-prefix-caching is enabled', () => {
    expect(block).toMatch(/--enable-prefix-caching/);
  });

  it('--max-num-batched-tokens=8192 is explicit', () => {
    expect(block).toMatch(/--max-num-batched-tokens=8192/);
  });

  it('--max-num-seqs=256 is explicit', () => {
    expect(block).toMatch(/--max-num-seqs=256/);
  });

  it('--speculative-model NOT enabled in this PR (deferred, see runbook §3)', () => {
    expect(block).not.toMatch(/--speculative-model=/);
    expect(block).not.toMatch(/--num-speculative-tokens=/);
  });

  it('Wrong-family draft model (Qwen2.5-*) is NEVER referenced in command', () => {
    // Qwen2.5 has a different tokenizer in some configs → would silently
    // break spec-decoding. Guard against accidental re-introduction.
    const commandLines = block.match(/command:\s*\n([\s\S]*?)\n {4}\w/);
    const commandStr = commandLines ? commandLines[1] : '';
    expect(commandStr).not.toMatch(/Qwen2\.5/);
  });
});

describe('Phase 12 WP 2.2 — runbook', () => {
  const runbook = readOrEmpty(RUNBOOK);

  it('VLLM_TUNING_RUNBOOK.md exists', () => {
    expect(runbook.length).toBeGreaterThan(0);
  });

  it('documents prefix caching rationale (TTFT win)', () => {
    expect(runbook).toMatch(/prefix.cach/i);
    expect(runbook).toMatch(/TTFT/);
  });

  it('explicitly defers spec-decoding (lists Qwen3 draft model)', () => {
    expect(runbook).toMatch(/Qwen3-0\.6B|Qwen3-1\.7B/);
    expect(runbook).toMatch(/deferr|defer\b|defer red/i);
  });

  it('documents rollback procedure', () => {
    expect(runbook).toMatch(/Rollback|rollback/);
    expect(runbook).toMatch(/git revert/);
  });

  it('links related WPs (1.6, 0.3, 4.1)', () => {
    expect(runbook).toMatch(/WP 0\.3|WP 1\.6|WP 4\.1/);
  });
});

describe('Phase 12 WP 2.2 — embedding service NOT touched (no prefix cache for encoders)', () => {
  // Embedding-only models do a single forward pass per input; prefix-caching
  // is a generation-loop optimisation. Adding it to vllm-embedding wastes
  // GPU memory for zero benefit.
  it('vllm-embedding does NOT have --enable-prefix-caching', () => {
    const compose = readOrEmpty(COMPOSE);
    const startIdx = compose.indexOf('vllm-embedding:');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    const tail = compose.slice(startIdx);
    // Stop at the first of: section-divider comment `\n  # -----`, or next
    // service header `\n  <letter>...:`. Section dividers separate service
    // blocks and any flag mentions there belong to the NEXT service.
    const sectionDividerMatch = tail.slice(1).match(/\n {2}# -{3,}/);
    const nextSvcMatch = tail.slice(1).match(/\n {2}[A-Za-z][\w-]*:\n/);
    const candidates = [
      sectionDividerMatch ? sectionDividerMatch.index! + 1 : Infinity,
      nextSvcMatch ? nextSvcMatch.index! + 1 : Infinity,
    ];
    const endIdx = Math.min(...candidates, tail.length);
    const block = tail.slice(0, endIdx);
    expect(block).not.toMatch(/--enable-prefix-caching/);
  });
});
