/**
 * Gate: compose_context graph_context layer (Step 7.3 follow-up)
 *
 * Why this exists:
 *   The knowledge graph (graph_nodes/graph_edges + fn_graph_multihop) was built and
 *   surfaced in the explainability panel (fn_get_run_graph_context), but it was NOT
 *   an input to the LLM at reasoning time — compose_context had no graph layer, so
 *   the model never consulted the graph while answering. This gate locks in the
 *   Step 7.3 follow-up: the graph is wired INTO compose_context as a retrieval layer,
 *   seeded from kb_retrieval and enabled on the RAG profiles.
 *
 * Pure static/file checks (no DB) — the traversal itself (fn_graph_multihop) is
 * already runtime-proven by run-graph-context.gate.test.ts.
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const COMPOSE = join(ROOT, "aisha/db/sql/functions/compose_context.sql");
const SEED = join(ROOT, "aisha/db/seed/core/20_aisha_backbone.sql");

describe("compose_context graph_context layer", () => {
  const compose = readFileSync(COMPOSE, "utf8");

  test("compose_context defines a graph_context layer", () => {
    expect(compose, "graph_context layer branch must exist").toMatch(
      /v_layer\s*=\s*'graph_context'/,
    );
    // Must consume the kb_retrieval output (seed from the just-retrieved items)…
    expect(compose, "graph_context must seed from kb_retrieval (v_kb_ctx)").toContain(
      "v_kb_ctx->'chunks'",
    );
    // …seed graph_nodes from those knowledge_items…
    expect(compose).toContain("gn.source_table = 'knowledge_items'");
    // …and traverse via the proven multi-hop function…
    expect(compose, "graph_context must use fn_graph_multihop").toMatch(
      /fn_graph_multihop\s*\(/,
    );
    // …emitting under the graph_context bundle key with a token-budget cost.
    expect(compose).toMatch(/jsonb_build_object\('graph_context'/);
  });

  test("graph_context is enabled on RAG profiles, ordered right after kb_retrieval", () => {
    const seed = readFileSync(SEED, "utf8");
    // Idempotent enablement UPDATE present…
    expect(seed, "seed must enable graph_context").toMatch(
      /'graph_context'[\s\S]{0,120}?'enabled',\s*true/,
    );
    // …scoped to kb_retrieval-enabled profiles, inserted after kb_retrieval.
    expect(seed).toContain("WHERE t.elem = 'kb_retrieval'");
    expect(seed).toMatch(/layers->'kb_retrieval'->>'enabled'/);
  });

  test("compose_context function SoT defines compose_context and wires graph_context", () => {
    // Baseline-only state: the graph-layer change lives permanently in the
    // compose_context function SoT (not as a standalone pending migration). The
    // function definition the change delivered is the canonical compose_context
    // body; assert it here against SoT, preserving the original invariant —
    // (1) compose_context is (re)defined, and (2) it wires the graph_context layer.
    expect(compose).toMatch(/CREATE OR REPLACE FUNCTION public\.compose_context/);
    expect(compose, "compose_context SoT must wire graph_context too").toContain(
      "graph_context",
    );
  });
});
