/**
 * Gate — ToT v1 graph (E1.2 / invariant I10).
 *
 * Locks that reasoning-tree-reflect.json is a VALID, RUNNABLE reasoning-graph and
 * that the policy lives in the NODES, not the edges:
 *   - it parses against the engine's GraphSchema;
 *   - every node.type resolves in NODE_HANDLERS (would not throw at runtime);
 *   - every edge condition is FLAT (single identifier + comparison) — the guarded
 *     edge grammar supports no functions/objects/dot-paths, so all branching
 *     logic must be reduced to flat tot_action/tot_done by tot_search;
 *   - a SIMULATED run over the real handlers (LLM mocked) drives
 *     planner -> expand -> evaluate -> search and terminates — both the
 *     sure-terminal path and the back-edge loop to exhaustion.
 *
 * Offline + deterministic: llmRouter + decision are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graph, NodeContext, RunRecord, WorkflowDefinitionRecord } from '../../reflection/types.js';

const { unifiedChat, dispatchDecision } = vi.hoisted(() => ({ unifiedChat: vi.fn(), dispatchDecision: vi.fn() }));
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));
vi.mock('../../lib/llmRouter.js', () => ({ unifiedChat }));
vi.mock('../../reflection/decision.js', () => ({ dispatchDecision }));

import { GraphSchema } from '../../reflection/types.js';
import { NODE_HANDLERS } from '../../reflection/nodes/index.js';

const GRAPH_FILE = fileURLToPath(new URL('../../reflection/graphs/reasoning-tree-reflect.json', import.meta.url));
const def = JSON.parse(readFileSync(GRAPH_FILE, 'utf8')) as { graph: unknown };
const graph = GraphSchema.parse(def.graph); // throws if the graph is structurally invalid

/** Faithful flat-only edge evaluator (mirrors orchestrator.evalGuardedExpression's `<id> <op> <lit>`). */
function evalFlat(cond: string, state: Record<string, unknown>): boolean {
  const m = cond.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) return false;
  const [, left, op, rightRaw] = m;
  const l = state[left];
  let r: unknown = rightRaw.trim();
  if (r === 'true') r = true;
  else if (r === 'false') r = false;
  else if (/^-?\d+(\.\d+)?$/.test(r as string)) r = Number(r);
  else if (/^'[^']*'$/.test(r as string) || /^"[^"]*"$/.test(r as string)) r = (r as string).slice(1, -1);
  switch (op) {
    case '==': return l === r;
    case '!=': return l !== r;
    case '>=': return (l as number) >= (r as number);
    case '<=': return (l as number) <= (r as number);
    case '>': return (l as number) > (r as number);
    case '<': return (l as number) < (r as number);
    default: return false;
  }
}

function makeRun(): RunRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111', kind: 'reflection', story_id: null, actor_user_id: null,
    status: 'running', workflow_definition_id: '22222222-2222-2222-2222-222222222222',
    metadata: { input: { description: 'solve X' } }, cost_total_json: {},
  };
}

/** Minimal orchestrator core: run handler -> merge state_patch -> pick next edge by flat condition. */
async function simulate(g: Graph): Promise<{ state: Record<string, unknown>; visited: string[]; iters: number }> {
  const run = makeRun();
  const workflow = { ...run, name: 'reasoning-tree-reflect', display_name: '', graph: g, context: 'reflection', is_active: true, version: 1, metadata: {} } as unknown as WorkflowDefinitionRecord;
  const state: Record<string, unknown> = {};
  const visited: string[] = [];
  let current: string | null = g.entry;
  let iters = 0;
  const maxIters = g.max_iterations ?? 20;
  while (current && iters < maxIters) {
    iters++;
    const gnode = g.nodes.find((n) => n.id === current)!;
    const ctx: NodeContext = { run, workflow, node: gnode, state, iteration: iters };
    const out = await NODE_HANDLERS[gnode.type](ctx);
    if (out.fatal_error) throw new Error(`node ${gnode.id} fatal: ${out.fatal_error}`);
    Object.assign(state, out.state_patch ?? {});
    visited.push(gnode.type);
    const outgoing = g.edges.filter((e) => e.from === current);
    let next: string | null = null;
    for (const e of outgoing) {
      if (!e.condition) { if (!next) next = e.to; continue; }
      if (evalFlat(e.condition, state)) { next = e.to; break; }
    }
    current = next;
  }
  return { state, visited, iters };
}

beforeEach(() => {
  dispatchDecision.mockReset().mockResolvedValue({ model: 'm', provider: 'anthropic', decision_id: 'd', resolution_source: 'slot' });
  unifiedChat.mockReset();
});

describe('reasoning-tree graph — structural validity', () => {
  it('parses against GraphSchema and entry resolves', () => {
    expect(graph.entry).toBe('tot_planner');
    expect(graph.nodes.find((n) => n.id === graph.entry)).toBeTruthy();
    expect(graph.max_iterations).toBeGreaterThan(0); // E0.6 per-graph cap for the high-fanout loop
  });

  it('every node type is registered in NODE_HANDLERS (no runtime "no handler" throw)', () => {
    for (const n of graph.nodes) {
      expect(NODE_HANDLERS[n.type], `missing handler for ${n.type}`).toBeTypeOf('function');
    }
  });

  it('I10: every edge condition is FLAT — single identifier + comparison, no dot-path/function/object', () => {
    const FLAT = /^[a-z_][a-z0-9_]*\s*(==|!=|>=|<=|>|<)\s*('[^']*'|"[^"]*"|true|false|-?\d+(\.\d+)?)$/i;
    for (const e of graph.edges) {
      if (!e.condition) continue;
      expect(FLAT.test(e.condition.trim()), `non-flat edge condition: "${e.condition}"`).toBe(true);
    }
  });

  it('wires the planner -> expand -> evaluate -> search loop with the flat back-edge', () => {
    const has = (from: string, to: string) => graph.edges.some((e) => e.from === from && e.to === to);
    expect(has('tot_planner', 'tot_expand')).toBe(true);
    expect(has('tot_expand', 'tot_evaluate')).toBe(true);
    expect(has('tot_evaluate', 'tot_search')).toBe(true);
    const back = graph.edges.find((e) => e.from === 'tot_search' && e.to === 'tot_expand');
    expect(back?.condition).toBe("tot_action == 'expand'");
  });
});

describe('reasoning-tree graph — simulated run (real handlers, mocked LLM)', () => {
  it('reaches a terminal via the sure path and visits all four ToT nodes', async () => {
    // Drafts for expand; high scores for evaluate → a sure thought → search terminates.
    unifiedChat.mockImplementation((opts: { jsonMode?: boolean }) =>
      Promise.resolve(
        opts.jsonMode
          ? { text: JSON.stringify({ scores: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`t${i + 1}`, 0.95])) }), model: 'm', provider: 'p', usage: { inputTokens: 1, outputTokens: 1 } }
          : { text: 'a candidate next thought', model: 'm', provider: 'p', usage: { inputTokens: 1, outputTokens: 1 } },
      ),
    );
    const { state, visited, iters } = await simulate(graph);
    expect(state.tot_done).toBe(true);
    expect(iters).toBeLessThan(graph.max_iterations ?? 20);
    expect(new Set(visited)).toEqual(new Set(['tot_planner', 'tot_expand', 'tot_evaluate', 'tot_search']));
  });

  it('loops the back-edge and terminates by budget exhaustion when nothing is "sure"', async () => {
    // No scores → all neutral 'maybe' → search loops expand until max_expansions.
    unifiedChat.mockImplementation((opts: { jsonMode?: boolean }) =>
      Promise.resolve(
        opts.jsonMode
          ? { text: '{}', model: 'm', provider: 'p', usage: { inputTokens: 1, outputTokens: 1 } }
          : { text: 'draft', model: 'm', provider: 'p', usage: { inputTokens: 1, outputTokens: 1 } },
      ),
    );
    // Tighten the budget on a clone so the loop is short + deterministic.
    const tight: Graph = structuredClone(graph);
    tight.nodes = tight.nodes.map((n) => (n.type === 'tot_planner' ? { ...n, config: { max_expansions: 2, max_fanout: 2 } } : n));
    const { state, visited } = await simulate(tight);
    expect(state.tot_done).toBe(true);
    // The back-edge fired at least once → tot_expand visited more than once.
    expect(visited.filter((v) => v === 'tot_expand').length).toBeGreaterThanOrEqual(2);
  });
});
