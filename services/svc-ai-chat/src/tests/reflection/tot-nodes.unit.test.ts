/**
 * Gate — ToT v1 nodes (E1 / invariant I9).
 *
 * Locks the load-bearing single-run Tree-of-Thoughts behaviour:
 *   - classifyThought thresholding (Sure / Maybe / Impossible) — the verdict
 *     mapping the whole search hinges on;
 *   - tot_planner seeds the tree + REUSES planDeliberation (#443) for the fanout;
 *   - tot_expand fans out k journaled drafters (I1: a dispatch per drafter);
 *   - tot_evaluate scores over the same critic-style 0..1 JSON then classifies;
 *   - tot_search is a pure controller emitting ONLY flat tot_action/tot_done.
 *
 * llmRouter + decision are mocked so the test is deterministic and offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeContext, RunRecord, WorkflowDefinitionRecord, GraphNode } from '../../reflection/types.js';

const { unifiedChat, dispatchDecision } = vi.hoisted(() => ({
  unifiedChat: vi.fn(),
  dispatchDecision: vi.fn(),
}));

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

import { totPlanner } from '../../reflection/nodes/tot_planner.js';
import { totExpand } from '../../reflection/nodes/tot_expand.js';
import { totEvaluate } from '../../reflection/nodes/tot_evaluate.js';
import { totSearch } from '../../reflection/nodes/tot_search.js';
import {
  classifyThought,
  DEFAULT_TOT_POLICY,
  type ToTState,
  type ThoughtNode,
} from '../../reflection/tot/types.js';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------
function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    kind: 'reflection',
    story_id: null,
    actor_user_id: null,
    status: 'running',
    workflow_definition_id: '22222222-2222-2222-2222-222222222222',
    metadata: { workflow_name: 'reasoning-tree-reflect', input: { description: 'solve X' } },
    cost_total_json: {},
    ...overrides,
  };
}
function makeCtx(node: GraphNode, state: Record<string, unknown> = {}, run = makeRun()): NodeContext {
  return {
    run,
    workflow: {
      ...run, name: 'reasoning-tree-reflect', display_name: '',
      graph: { entry: '', nodes: [], edges: [] }, context: 'reflection', is_active: true, version: 1, metadata: {},
    } as WorkflowDefinitionRecord,
    node,
    state,
    iteration: 1,
  };
}
const node = (type: string, config: Record<string, unknown> = {}): GraphNode => ({ id: type, type: type as never, config });
const thought = (o: Partial<ThoughtNode> & { id: string }): ThoughtNode => ({ depth: 1, content: 'c', status: 'unevaluated', ...o });
function totState(over: Partial<ToTState> = {}): ToTState {
  return {
    tree: { root: thought({ id: 'root', depth: 0, content: 'solve X' }) },
    frontier: ['root'],
    expansions: 0,
    policy: { ...DEFAULT_TOT_POLICY },
    topology: 'tree',
    ...over,
  };
}

beforeEach(() => {
  unifiedChat.mockReset();
  dispatchDecision.mockReset();
  dispatchDecision.mockResolvedValue({ model: 'm', provider: 'anthropic', decision_id: 'd1', resolution_source: 'slot' });
});

// --------------------------------------------------------------------------
// classifyThought — the Sure/Maybe/Impossible thresholding (I9 core)
// --------------------------------------------------------------------------
describe('classifyThought (I9 thresholding)', () => {
  const p = { sure_threshold: 0.8, impossible_threshold: 0.35 };
  it('>= sure_threshold → sure (boundary inclusive)', () => {
    expect(classifyThought(0.95, p)).toBe('sure');
    expect(classifyThought(0.8, p)).toBe('sure');
  });
  it('<= impossible_threshold → impossible (boundary inclusive)', () => {
    expect(classifyThought(0.1, p)).toBe('impossible');
    expect(classifyThought(0.35, p)).toBe('impossible');
  });
  it('strictly between → maybe', () => {
    expect(classifyThought(0.5, p)).toBe('maybe');
    expect(classifyThought(0.79, p)).toBe('maybe');
  });
  it('non-finite → unevaluated', () => {
    expect(classifyThought(Number.NaN, p)).toBe('unevaluated');
  });
});

// --------------------------------------------------------------------------
// tot_planner — seed + REUSE planDeliberation for fanout
// --------------------------------------------------------------------------
describe('tot_planner', () => {
  it('seeds root + frontier and derives wave_width from planDeliberation (#443 reuse)', async () => {
    const out = await totPlanner(makeCtx(node('tot_planner')));
    const tot = out.state_patch!.tot as ToTState;
    expect(tot.tree.root.content).toBe('solve X');
    expect(tot.frontier).toEqual(['root']);
    expect(tot.topology).toBe('tree'); // decomposable → tree
    expect(tot.policy.wave_width).toBe(3); // planDeliberation default fanout
    expect(out.state_patch!.tot_action).toBe('expand');
    expect(out.state_patch!.tot_done).toBe(false);
    expect(unifiedChat).not.toHaveBeenCalled(); // planner makes no LLM call
  });
  it('honours a maxFanout=1 kill-switch (deliberation off → wave_width 1)', async () => {
    const out = await totPlanner(makeCtx(node('tot_planner', { max_fanout: 1 })));
    expect((out.state_patch!.tot as ToTState).policy.wave_width).toBe(1);
  });
});

// --------------------------------------------------------------------------
// tot_expand — k journaled drafters (I1)
// --------------------------------------------------------------------------
describe('tot_expand', () => {
  it('fans out wave_width drafters, journaling each, and re-frontiers the children', async () => {
    unifiedChat.mockResolvedValue({ text: 'a thought', model: 'm', provider: 'anthropic', usage: { inputTokens: 5, outputTokens: 7 } });
    const tot = totState({ policy: { ...DEFAULT_TOT_POLICY, wave_width: 3 } });
    const out = await totExpand(makeCtx(node('tot_expand'), { tot }));
    expect(dispatchDecision).toHaveBeenCalledTimes(3); // I1: one journaled decision per drafter
    expect(unifiedChat).toHaveBeenCalledTimes(3);
    const next = out.state_patch!.tot as ToTState;
    expect(next.frontier).toHaveLength(3);
    expect(Object.keys(next.tree)).toHaveLength(4); // root + 3 children
    expect(next.expansions).toBe(1);
    expect(out.state_patch!.tot_action).toBe('evaluate');
  });
  it('fatal-errors if invoked before tot_planner (no state.tot)', async () => {
    const out = await totExpand(makeCtx(node('tot_expand'), {}));
    expect(out.fatal_error).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// tot_evaluate — score (critic-style JSON) + classify
// --------------------------------------------------------------------------
describe('tot_evaluate', () => {
  it('scores the frontier via one journaled dispatch and classifies each thought', async () => {
    const tot = totState({
      tree: {
        root: thought({ id: 'root', depth: 0 }),
        t1: thought({ id: 't1', content: 'great' }),
        t2: thought({ id: 't2', content: 'dead end' }),
      },
      frontier: ['t1', 't2'],
    });
    unifiedChat.mockResolvedValue({
      text: JSON.stringify({ scores: { t1: 0.92, t2: 0.2 } }),
      model: 'm', provider: 'anthropic', usage: { inputTokens: 9, outputTokens: 3 },
    });
    const out = await totEvaluate(makeCtx(node('tot_evaluate'), { tot }));
    expect(dispatchDecision).toHaveBeenCalledTimes(1);
    const next = out.state_patch!.tot as ToTState;
    expect(next.tree.t1.status).toBe('sure');
    expect(next.tree.t2.status).toBe('impossible');
    expect(out.output_data.sure).toBe(1);
    expect(out.output_data.impossible).toBe(1);
    expect(out.state_patch!.tot_action).toBe('search');
  });
  it('treats unscored thoughts as neutral maybe (robust to partial JSON)', async () => {
    const tot = totState({ tree: { root: thought({ id: 'root', depth: 0 }), t1: thought({ id: 't1' }) }, frontier: ['t1'] });
    unifiedChat.mockResolvedValue({ text: '{ not json', model: 'm', provider: 'anthropic', usage: { inputTokens: 1, outputTokens: 1 } });
    const out = await totEvaluate(makeCtx(node('tot_evaluate'), { tot }));
    expect((out.state_patch!.tot as ToTState).tree.t1.status).toBe('maybe');
  });
});

// --------------------------------------------------------------------------
// tot_search — pure controller, FLAT routing only
// --------------------------------------------------------------------------
describe('tot_search', () => {
  it('terminates with flat tot_done=true when a sure thought exists', async () => {
    const tot = totState({
      tree: { root: thought({ id: 'root', depth: 0 }), t1: thought({ id: 't1', status: 'sure', score: 0.9 }) },
      frontier: ['t1'],
    });
    const out = await totSearch(makeCtx(node('tot_search'), { tot }));
    expect(out.state_patch!.tot_done).toBe(true);
    expect(out.state_patch!.tot_action).toBe('done');
    expect((out.state_patch!.tot as ToTState).best).toBe('t1');
    // No nested object leaks into the routing fields the edges read.
    expect(typeof out.state_patch!.tot_action).toBe('string');
  });
  it('beam-selects the next frontier (flat tot_action=expand) when only maybes remain under budget', async () => {
    const tot = totState({
      tree: {
        root: thought({ id: 'root', depth: 0 }),
        a: thought({ id: 'a', status: 'maybe', score: 0.6 }),
        b: thought({ id: 'b', status: 'maybe', score: 0.7 }),
        c: thought({ id: 'c', status: 'maybe', score: 0.5 }),
        d: thought({ id: 'd', status: 'impossible', score: 0.1 }),
      },
      frontier: ['a', 'b', 'c', 'd'],
      expansions: 1,
      policy: { ...DEFAULT_TOT_POLICY, wave_width: 2 },
    });
    const out = await totSearch(makeCtx(node('tot_search'), { tot }));
    expect(out.state_patch!.tot_done).toBe(false);
    expect(out.state_patch!.tot_action).toBe('expand');
    expect((out.state_patch!.tot as ToTState).frontier).toEqual(['b', 'a']); // beam top-2, best-first
  });
  it('terminates when the expansion budget is exhausted', async () => {
    const tot = totState({
      tree: { root: thought({ id: 'root', depth: 0 }), a: thought({ id: 'a', status: 'maybe', score: 0.6 }) },
      frontier: ['a'],
      expansions: DEFAULT_TOT_POLICY.max_expansions,
    });
    const out = await totSearch(makeCtx(node('tot_search'), { tot }));
    expect(out.state_patch!.tot_done).toBe(true);
    expect(out.output_data.reason).toBe('exhausted');
  });
});
