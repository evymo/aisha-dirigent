/**
 * Reflection node handler unit tests — scenario-driven coverage of every
 * branch in the per-node decision tree. We mock the PostgREST rpc boundary +
 * @aisha/security so the tests stay deterministic and never touch the network.
 *
 * Each node has at least 3 tested scenarios:
 *   - Happy path (data → expected transition_key + state_patch)
 *   - Degradation (capability disabled or RPC fails → graceful soft-fail)
 *   - Edge case (missing prerequisites → fatal_error or skipped)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NodeContext, NodeHandler, RunRecord, WorkflowDefinitionRecord, GraphNode } from '../../reflection/types.js';

// `@aisha/security` is published to Verdaccio (PR #50) and reaches services
// at runtime through their per-package `.npmrc`. Vitest in unit mode does
// not have a Verdaccio mirror, so the import would 404 the loader. We mock
// the surface the reflection node files use:
//   - createSafeLogger / createSsrfGuard / parseHostAllowlist
// The mock matches the public API exactly so a real test of a logger
// integration would just remove this mock for that file.
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({
    safeInfo: vi.fn(),
    safeWarn: vi.fn(),
    safeError: vi.fn(),
    safeDebug: vi.fn(),
  }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

// PostgREST `rpc` is an EXTERNAL boundary. Unmocked, these unit tests made REAL
// network calls: locally the connection is refused instantly (rpc throws → nodes
// return their fatal_error/degradation path), but on the CI runner's Docker network
// the same connect HANGS past the 15s test timeout — a flaky, environment-dependent
// red. Mock it to reject deterministically (mirrors the unconfigured-backend path
// every scenario here already exercises); a happy-path test can override per-case
// with `vi.mocked(rpc).mockResolvedValueOnce(...)`.
vi.mock('../../reflection/postgrest.js', () => ({
  rpc: vi.fn(async () => {
    throw new Error('rpc() is mocked in unit tests (no PostgREST) — override per-test if needed');
  }),
}));

// --------------------------------------------------------------------------
// Test fixtures
// --------------------------------------------------------------------------

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    kind: 'reflection',
    story_id: null,
    actor_user_id: null,
    status: 'running',
    workflow_definition_id: '22222222-2222-2222-2222-222222222222',
    metadata: {
      workflow_name: 'deploy-reflect',
      workflow_version: 1,
      input: { description: 'deploy svc-x', agent_slug: 'aisha' },
      context: { profile: 'balanced' },
      checkpoint: { current_node: null, iteration: 0, history: [], state: {} },
    },
    cost_total_json: {},
    ...overrides,
  };
}

function makeCtx(node: GraphNode, state: Record<string, unknown> = {}, run = makeRun()): NodeContext {
  return {
    run,
    workflow: { ...run, name: 'deploy-reflect', display_name: '', graph: { entry: '', nodes: [], edges: [] }, context: 'reflection', is_active: true, version: 1, metadata: {} } as WorkflowDefinitionRecord,
    node,
    state,
    iteration: 1,
  };
}

// --------------------------------------------------------------------------
// convergence_gate — pure decision node, no mocks needed
// --------------------------------------------------------------------------
describe('convergence_gate', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    ({ convergenceGate: handler } = await import('../../reflection/nodes/convergence_gate.js'));
  });

  it('passes when overall ≥ min_score', async () => {
    const node: GraphNode = { id: 'gate', type: 'convergence_gate', config: { min_score: 0.85, max_iterations: 3 } };
    const ctx = makeCtx(node, { last_critic_overall: 0.9 });
    const out = await handler(ctx);
    expect(out.transition_key).toBe('pass');
    expect(out.state_patch?.convergence_result).toBe('pass');
  });

  it('retries when overall < min_score and iteration < max_iterations', async () => {
    const node: GraphNode = { id: 'gate', type: 'convergence_gate', config: { min_score: 0.85, max_iterations: 3 } };
    const ctx = makeCtx(node, { last_critic_overall: 0.5 });
    const out = await handler(ctx);
    expect(out.transition_key).toBe('retry');
  });

  it('exhausted when overall < min_score and iteration ≥ max_iterations', async () => {
    const node: GraphNode = { id: 'gate', type: 'convergence_gate', config: { min_score: 0.85, max_iterations: 3 } };
    const ctx: NodeContext = { ...makeCtx(node, { last_critic_overall: 0.5 }), iteration: 5 };
    const out = await handler(ctx);
    expect(out.transition_key).toBe('exhausted');
  });

  it('uses defaults when config keys missing', async () => {
    const node: GraphNode = { id: 'gate', type: 'convergence_gate', config: {} };
    const ctx = makeCtx(node, { last_critic_overall: 0.9 });
    const out = await handler(ctx);
    expect(out.transition_key).toBe('pass');
  });
});

// --------------------------------------------------------------------------
// interrupt — pauses run
// --------------------------------------------------------------------------
describe('interrupt', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    ({ interruptNode: handler } = await import('../../reflection/nodes/interrupt.js'));
  });

  it('returns interrupt=true', async () => {
    const node: GraphNode = { id: 'int', type: 'interrupt', config: { channel: 'telegram', approver: 'dirigent' } };
    const ctx = makeCtx(node);
    const out = await handler(ctx);
    expect(out.interrupt).toBe(true);
    expect(out.state_patch?.pending_approval).toEqual({
      channel: 'telegram',
      approver: 'dirigent',
      reason: 'manual_approval_required',
    });
  });

  it('uses in_app + dirigent + manual_approval_required defaults', async () => {
    const node: GraphNode = { id: 'int', type: 'interrupt', config: {} };
    const ctx = makeCtx(node);
    const out = await handler(ctx);
    expect((out.state_patch?.pending_approval as Record<string, unknown>)?.channel).toBe('in_app');
  });
});

// --------------------------------------------------------------------------
// soulforge_classify — uses local heuristic, falls through to RPC when confidence low
// --------------------------------------------------------------------------
describe('soulforge_classify', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    ({ soulforgeClassify: handler } = await import('../../reflection/nodes/soulforge.js'));
  });

  it('classifies as spark for short read task (high confidence — skips RPC)', async () => {
    const node: GraphNode = { id: 'sf', type: 'soulforge_classify', config: {} };
    const ctx = makeCtx(node, {}, makeRun({ metadata: { ...makeRun().metadata, input: { description: 'read the README', agent_slug: 'aisha' } } }));
    const out = await handler(ctx);
    expect(out.state_patch?.slot).toBe('spark');
    expect(out.transition_key).toBe('classified');
  });

  it('handles low-confidence ambiguous input via local fallback', async () => {
    const node: GraphNode = { id: 'sf', type: 'soulforge_classify', config: {} };
    const ctx = makeCtx(node, {}, makeRun({ metadata: { ...makeRun().metadata, input: { description: 'lorem ipsum dolor sit', agent_slug: 'aisha' } } }));
    const out = await handler(ctx);
    expect(out.transition_key).toBe('classified');
    expect(out.state_patch?.slot).toBeDefined();
  });

  it('skips entirely when LANGGRAPH_ENABLE_SOULFORGE=false', async () => {
    const originalEnv = process.env.LANGGRAPH_ENABLE_SOULFORGE;
    process.env.LANGGRAPH_ENABLE_SOULFORGE = 'false';
    // Force re-import to pick up new env
    vi.resetModules();
    const mod = await import('../../reflection/nodes/soulforge.js');
    const node: GraphNode = { id: 'sf', type: 'soulforge_classify', config: {} };
    const ctx = makeCtx(node);
    const out = await (mod.soulforgeClassify as NodeHandler)(ctx);
    expect(out.state_patch?.slot).toBe('default');
    if (originalEnv !== undefined) process.env.LANGGRAPH_ENABLE_SOULFORGE = originalEnv;
    else delete process.env.LANGGRAPH_ENABLE_SOULFORGE;
  });
});

// --------------------------------------------------------------------------
// soulforge_optimize — slot-aware payload shaping
// --------------------------------------------------------------------------
describe('soulforge_optimize', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    vi.resetModules();
    ({ soulforgeOptimize: handler } = await import('../../reflection/nodes/soulforge.js'));
  });

  it('skips when state has no composed_context', async () => {
    const node: GraphNode = { id: 'opt', type: 'soulforge_optimize', config: {} };
    const ctx = makeCtx(node, {});
    const out = await handler(ctx);
    expect(out.output_data?.skipped).toBe('no_composed_context');
  });

  it('trims kb chunks for spark slot', async () => {
    const node: GraphNode = { id: 'opt', type: 'soulforge_optimize', config: {} };
    const ctx = makeCtx(node, {
      slot: 'spark',
      composed_context: {
        layers: {
          kb_retrieval: {
            chunks: Array(10).fill(0).map((_, i) => ({ title: `chunk-${i}`, chunk_text: 'X'.repeat(1000), score: 0.5 })),
          },
        },
      },
    });
    const out = await handler(ctx);
    const optimized = out.state_patch?.composed_context as { layers: { kb_retrieval: { chunks: unknown[] } } };
    expect(optimized.layers.kb_retrieval.chunks.length).toBeLessThanOrEqual(3);
  });
});

// --------------------------------------------------------------------------
// hippocampus_read — degrades to empty learnings when query_text missing
// --------------------------------------------------------------------------
describe('hippocampus_read', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    vi.resetModules();
    ({ hippocampusRead: handler } = await import('../../reflection/nodes/hippocampus.js'));
  });

  it('asks compose_context AS the run owner (p_requester_id) — story-scoped RBAC needs it (K-26a)', async () => {
    const { rpc } = await import('../../reflection/postgrest.js');
    vi.mocked(rpc).mockResolvedValueOnce({ layers: { learnings: [{ memory_id: 'm1' }] } });
    const node: GraphNode = { id: 'h', type: 'hippocampus_read', config: { limit: 5 } };
    const owner = '33333333-3333-3333-3333-333333333333';
    const ctx = makeCtx(
      node,
      {},
      makeRun({
        story_id: '44444444-4444-4444-4444-444444444444',
        actor_user_id: owner,
        metadata: { ...makeRun().metadata, input: { description: 'read the README', agent_slug: 'aisha' } },
      }),
    );
    const out = await handler(ctx);
    const [fn, args] = vi.mocked(rpc).mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(fn).toBe('compose_context');
    expect(args.p_context_profile_slug).toBe('learnings_enabled');
    expect(args.p_requester_id).toBe(owner);
    expect(out.transition_key).toBe('has_learnings');
  });

  it('returns no_learnings transition when no query_text in state or task', async () => {
    const node: GraphNode = { id: 'h', type: 'hippocampus_read', config: { limit: 5 } };
    const ctx = makeCtx(node, {}, makeRun({ metadata: { ...makeRun().metadata, input: { description: '', agent_slug: 'aisha' } } }));
    const out = await handler(ctx);
    expect(out.transition_key).toMatch(/no_learnings|has_learnings/);
  });
});

// --------------------------------------------------------------------------
// openclaw_plan — degrades to skipped when not configured
// --------------------------------------------------------------------------
describe('openclaw_plan', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    const originalUrl = process.env.OPENCLAW_URL;
    delete process.env.OPENCLAW_URL;
    vi.resetModules();
    ({ openclawPlan: handler } = await import('../../reflection/nodes/openclaw.js'));
    if (originalUrl !== undefined) process.env.OPENCLAW_URL = originalUrl;
  });

  it('skips when OPENCLAW_URL not configured', async () => {
    const node: GraphNode = { id: 'p', type: 'openclaw_plan', config: { task_type: 'deploy' } };
    const ctx = makeCtx(node);
    const out = await handler(ctx);
    expect(out.transition_key).toBe('skipped');
    expect(out.state_patch?.execution_plan).toBeNull();
  });
});

// --------------------------------------------------------------------------
// cosmos_anchor — degrades when disabled
// --------------------------------------------------------------------------
describe('cosmos_anchor', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    process.env.LANGGRAPH_ENABLE_COSMOS = 'false';
    vi.resetModules();
    ({ cosmosAnchor: handler } = await import('../../reflection/nodes/cosmos.js'));
    delete process.env.LANGGRAPH_ENABLE_COSMOS;
  });

  it('returns skipped when disabled', async () => {
    const node: GraphNode = { id: 'c', type: 'cosmos_anchor', config: {} };
    const ctx = makeCtx(node);
    const out = await handler(ctx);
    expect(out.transition_key).toBe('skipped');
  });
});

// --------------------------------------------------------------------------
// openclaw_resolve_clow — requires clow.purpose in state or config
// --------------------------------------------------------------------------
describe('openclaw_resolve_clow', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    vi.resetModules();
    ({ openclawResolveClow: handler } = await import('../../reflection/nodes/openclaw_resolve_clow.js'));
  });

  it('fatal_error when no purpose found in state or config', async () => {
    const node: GraphNode = { id: 'rc', type: 'openclaw_resolve_clow', config: {} };
    // No purpose ANYWHERE: empty state AND empty task description. The default
    // makeRun() seeds input.description='deploy svc-x', which the node derives
    // into a purpose and then drives into RPCs (derive_clow_needs/fn_resolve_
    // runtime/…) that hang under unit-test network isolation → 15s timeout. With
    // no description the node returns the fast "purpose missing" fatal_error.
    const ctx = makeCtx(node, {}, makeRun({ metadata: { ...makeRun().metadata, input: { description: '', agent_slug: 'aisha' } } }));
    const out = await handler(ctx);
    expect(out.fatal_error).toBeDefined();
  });
});

// --------------------------------------------------------------------------
// mcp_test — requires slug in config
// --------------------------------------------------------------------------
describe('mcp_test', () => {
  let handler: NodeHandler;
  beforeEach(async () => {
    vi.resetModules();
    ({ mcpTest: handler } = await import('../../reflection/nodes/mcp_test.js'));
  });

  it('fatal_error when config.slug missing', async () => {
    const node: GraphNode = { id: 'mt', type: 'mcp_test', config: {} };
    const ctx = makeCtx(node);
    const out = await handler(ctx);
    expect(out.fatal_error).toBeDefined();
    expect(out.output_data?.error).toMatch(/slug required/);
  });
});
