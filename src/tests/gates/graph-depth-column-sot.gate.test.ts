/**
 * Gate — knowledge-graph traversal depth/per_seed has ONE source of truth:
 * the typed, CHECK-constrained context_profiles columns (graph_depth / graph_per_seed).
 *
 * Two consumers traverse the multi-hop graph: compose_context (the retrieval the
 * LLM/ToT actually reasons over) and fn_get_run_graph_context (the explainability
 * panel). They MUST read the same surface, or the panel "explains" a different
 * depth than what was retrieved. Historically compose_context preferred a JSONB
 * blob (layers->graph_context->depth) that shadowed the column — this locks the
 * consolidation onto the column so panel-depth == retrieval-depth, and so the
 * depth is a typed knob the resolver/admission can govern (capability-availability).
 *
 * The JSONB graph_context keeps only presentation config (enabled, max_edges).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('graph-depth column SoT gate', () => {
  const compose = read('aisha/db/sql/functions/compose_context.sql');
  const panel = read('aisha/db/sql/functions/fn_get_run_graph_context.sql');
  const seed = read('aisha/db/seed/core/20_aisha_backbone.sql');

  it('compose_context derives depth/per_seed from the typed COLUMN, not the JSONB', () => {
    expect(compose).toMatch(/v_graph_depth\s+int\s*:=\s*v_profile\.graph_depth\s*;/);
    expect(compose).toMatch(/v_graph_per_seed\s+int\s*:=\s*v_profile\.graph_per_seed\s*;/);
    // the shadowing JSONB reads for depth/per_seed must be gone
    expect(compose).not.toContain("'graph_context'->>'depth'");
    expect(compose).not.toContain("'graph_context'->>'per_seed'");
  });

  it('compose_context still reads max_edges as per-layer JSONB config (kept by design)', () => {
    expect(compose).toContain("'graph_context'->>'max_edges'");
  });

  it('the explainability panel reads the same COLUMN (panel-depth == retrieval-depth)', () => {
    expect(panel).toMatch(/cp\.graph_depth/);
    expect(panel).toMatch(/cp\.graph_per_seed/);
  });

  it('the seed graph_context JSONB carries NO depth/per_seed (they live on the column)', () => {
    // new form: enabled + max_edges only
    expect(seed).toMatch(/jsonb_build_object\(\s*'enabled',\s*true,\s*'max_edges',\s*20\s*\)/);
    // old shadowing form must be gone
    expect(seed).not.toMatch(/'enabled',\s*true,\s*'depth',\s*2,\s*'per_seed',\s*8/);
  });

  it('the seed tunes the typed column per profile (evidence_strict deeper than default)', () => {
    expect(seed).toMatch(/graph_depth\s*=\s*3\s+WHERE\s+slug\s*=\s*'evidence_strict'/);
    // per_seed unified onto the column (was JSONB 8 / panel-default 10)
    expect(seed).toMatch(/graph_per_seed\s*=\s*8/);
  });
});
