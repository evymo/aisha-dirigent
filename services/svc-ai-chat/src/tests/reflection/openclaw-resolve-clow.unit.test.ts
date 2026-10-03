/**
 * openclaw_resolve_clow — runtime-axis derivation + fail-loud admission.
 *
 * The clow resolution now (PR-A): (1) DERIVES the executor runtime via
 * fn_resolve_runtime (capability-availability, not a hardcoded direct_llm),
 * failing loud when none is available; (2) FAILS LOUD on an admission RPC error
 * instead of swallowing it into 'allow'; (3) passes serviceable_slugs (the live
 * key truth) into the backend resolver. These lock that behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeContext, RunRecord, WorkflowDefinitionRecord, GraphNode } from '../../reflection/types.js';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../reflection/postgrest.js', () => ({ rpc }));
vi.mock('../../lib/llmRouter.js', () => ({ selectServiceableSlugs: () => ['openai', 'google-genai'] }));
vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(','),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { openclawResolveClow } from '../../reflection/nodes/openclaw_resolve_clow.js';

function makeCtx(state: Record<string, unknown> = {}, config: Record<string, unknown> = {}): NodeContext {
  const run = {
    id: '11111111-1111-1111-1111-111111111111', kind: 'reflection', story_id: null, actor_user_id: null,
    status: 'running', workflow_definition_id: '22222222-2222-2222-2222-222222222222',
    metadata: { context: {} }, cost_total_json: {},
  } as RunRecord;
  return {
    run,
    workflow: { ...run, name: 'x', display_name: '', graph: { entry: '', nodes: [], edges: [] }, context: 'reflection', is_active: true, version: 1, metadata: {} } as unknown as WorkflowDefinitionRecord,
    node: { id: 'r', type: 'openclaw_resolve_clow' as never, config: { constraints: { purpose: 'do a thing' }, ...config } } as GraphNode,
    state,
    iteration: 1,
  };
}

beforeEach(() => rpc.mockReset());

describe('openclaw_resolve_clow — runtime derivation + fail-loud', () => {
  it('derives the runtime, admits, resolves, and threads serviceable_slugs', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'fn_resolve_runtime') return { resolved: true, runtime: 'direct_llm' };
      if (fn === 'fn_admit_clow') return { decision: 'allow' };
      if (fn === 'aisha_resolve_clow_backend') return { resolved: true, top: { model_id: 'gpt-5-mini', provider_slug: 'openai' }, candidates: [] };
      return null;
    });
    const out = await openclawResolveClow(makeCtx());
    expect(out.transition_key).toBe('resolved');
    expect((out.state_patch!.clow_backend as { model_id: string }).model_id).toBe('gpt-5-mini');
    // serviceable_slugs were threaded into the resolver call.
    const resolveCall = rpc.mock.calls.find((c) => c[0] === 'aisha_resolve_clow_backend');
    expect((resolveCall![1] as { p_context: { serviceable_slugs: string[] } }).p_context.serviceable_slugs).toEqual(['openai', 'google-genai']);
  });

  it('FAILS LOUD when no capable+available runtime is derived (no blind direct_llm default)', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'fn_resolve_runtime' ? { resolved: false, reason: 'hermes disabled' } : null,
    );
    const out = await openclawResolveClow(makeCtx());
    expect(out.fatal_error).toContain('No capable+available runtime');
    // admission must NOT be reached when there is no runtime.
    expect(rpc.mock.calls.some((c) => c[0] === 'fn_admit_clow')).toBe(false);
  });

  it('FAILS LOUD on an admission RPC error instead of swallowing it into allow', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'fn_resolve_runtime') return { resolved: true, runtime: 'direct_llm' };
      if (fn === 'fn_admit_clow') throw new Error('db down');
      return null;
    });
    const out = await openclawResolveClow(makeCtx());
    expect(out.transition_key).toBe('admission_failed');
    expect(out.fatal_error).toContain('Admission check failed');
  });
});
