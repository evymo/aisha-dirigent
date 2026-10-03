/**
 * Gate — E0.6: per-graph iteration cap honored over the env default.
 *
 * A high-fanout graph (e.g. Tree-of-Thoughts) must be able to raise its own
 * iteration ceiling via the graph JSON (`max_iterations`) instead of being
 * pinned to the global env default `LANGGRAPH_MAX_ITERATIONS`. The orchestrator
 * therefore resolves `graph.max_iterations ?? config.maxIterationsPerRun`, and
 * `GraphSchema` must declare the optional field so the override is parseable.
 *
 * This locks the already-built wire-up against silent regression (someone
 * dropping the override back to the env-only default).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('E0.6 gate — graph-level max_iterations override', () => {
  it('orchestrator resolves the per-graph override before the env default', () => {
    const src = read('../../reflection/orchestrator.ts');
    // graph JSON value wins; env default (maxIterationsPerRun) is the fallback.
    expect(src).toMatch(/graph\.max_iterations\s*\?\?\s*config\.maxIterationsPerRun/);
  });

  it('GraphSchema declares the optional max_iterations field', () => {
    const types = read('../../reflection/types.ts');
    expect(types).toMatch(/max_iterations:\s*z\.number\(\)/);
  });

  it('the env default is still wired (LANGGRAPH_MAX_ITERATIONS) as the fallback', () => {
    const cfg = read('../../reflection/config.ts');
    expect(cfg).toContain('LANGGRAPH_MAX_ITERATIONS');
    expect(cfg).toContain('maxIterationsPerRun');
  });
});
