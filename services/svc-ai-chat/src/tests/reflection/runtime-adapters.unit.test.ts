/**
 * RuntimeAdapter (E3) — the EXECUTOR axis. Locks that the derived runtime actually
 * RUNS the work through the right surface (direct_llm → model router, openclaw →
 * agent-mesh HTTP, hermes → reflexive-learning rail), and that dispatch FAILS LOUD
 * when an adapter is unavailable (no silent downgrade — owner: "zadne fallbacky").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeContext, RunRecord, WorkflowDefinitionRecord, GraphNode } from '../../reflection/types.js';

const { cfg, unifiedChat, postToOpenclaw, rpc, resolveProvider, journalDispatch } = vi.hoisted(() => ({
  cfg: { enableOpenclaw: true, openclawUrl: '', openclawApiKey: '' },
  unifiedChat: vi.fn(),
  postToOpenclaw: vi.fn(),
  rpc: vi.fn(),
  resolveProvider: vi.fn((m: string) =>
    m.startsWith('gemini') ? 'google' : m.startsWith('claude') ? 'anthropic' : 'openai',
  ),
  journalDispatch: vi.fn().mockResolvedValue('decision-1'),
}));
vi.mock('../../lib/llmRouter.js', () => ({ unifiedChat, resolveProvider }));
vi.mock('../../lib/dispatchJournal.js', () => ({ journalDispatch }));
vi.mock('../../reflection/nodes/openclaw.js', () => ({ postToOpenclaw }));
vi.mock('../../reflection/postgrest.js', () => ({ rpc }));
vi.mock('../../reflection/config.js', () => ({ reflectionConfig: cfg }));

import { executeViaRuntime, runtimeAdapterHealth } from '../../reflection/runtime/adapters.js';
import { runtimeDispatch } from '../../reflection/nodes/runtime_dispatch.js';

beforeEach(() => {
  unifiedChat.mockReset();
  postToOpenclaw.mockReset();
  rpc.mockReset();
  cfg.enableOpenclaw = true;
  cfg.openclawUrl = '';
  cfg.openclawApiKey = '';
});

describe('executeViaRuntime — direct_llm', () => {
  it('runs the resolved model through unifiedChat and returns text + tokens', async () => {
    unifiedChat.mockResolvedValue({ text: 'hello', usage: { inputTokens: 5, outputTokens: 3 }, provider: 'openai', model: 'gpt-5-mini', isToolCall: false });
    const r = await executeViaRuntime('direct_llm', { clow: {}, input: 'hi', model: { provider: 'openai', model_id: 'gpt-5-mini' } });
    expect(r).toMatchObject({ runtime: 'direct_llm', ok: true, output: 'hello', tokensIn: 5, tokensOut: 3 });
    expect(unifiedChat).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5-mini', provider: 'openai' }));
    // I1: the dispatch was journaled (ai_decisions) before the raw call.
    expect(journalDispatch).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5-mini', runtime: 'direct_llm' }));
  });

  it('is ok:false when no model is resolved (does not call the router)', async () => {
    const r = await executeViaRuntime('direct_llm', { clow: {}, input: 'hi', model: null });
    expect(r.ok).toBe(false);
    expect(unifiedChat).not.toHaveBeenCalled();
  });
});

describe('executeViaRuntime — openclaw (agent-mesh HTTP)', () => {
  it('journals the dispatch (I1), then dispatches to OpenClaw when configured', async () => {
    cfg.openclawUrl = 'http://openclaw';
    cfg.openclawApiKey = 'k';
    // openclaw resolves no model, so it journals a RUNTIME-centric ai_decisions row via
    // fn_record_execution_decision BEFORE the side-effecting agent-mesh call (fail-closed).
    rpc.mockImplementation((fn: string) =>
      fn === 'fn_record_execution_decision' ? Promise.resolve('dec-oc') : Promise.resolve(null),
    );
    postToOpenclaw.mockResolvedValue({ ok: true, status: 200, data: { output: 'plan-ready' } });
    const r = await executeViaRuntime('openclaw', { clow: { type: 'general' }, input: 'build x', storyId: 'story-1' });
    expect(r).toMatchObject({ runtime: 'openclaw', ok: true, output: 'plan-ready' });
    expect(postToOpenclaw).toHaveBeenCalled();
    // I1 (executor axis): the decision was minted and threaded onto the result.
    expect(rpc).toHaveBeenCalledWith(
      'fn_record_execution_decision',
      expect.objectContaining({
        p_decision: expect.objectContaining({ runtime: 'openclaw', admission_verdict: 'allow' }),
        p_story_id: 'story-1',
      }),
    );
    expect(r.detail?.decision_id).toBe('dec-oc');
  });

  it('FAILS LOUD when OpenClaw is not configured (no downgrade to direct_llm)', async () => {
    cfg.openclawUrl = ''; // adapter unavailable
    await expect(executeViaRuntime('openclaw', { clow: {}, input: 'x' })).rejects.toThrow(/not available/i);
    expect(postToOpenclaw).not.toHaveBeenCalled();
  });
});

describe('executeViaRuntime — hermes (reflexive-learning rail)', () => {
  it('journals the dispatch (I1), then evaluates the story via the DB rail', async () => {
    // Route by RPC name: the journal returns a decision_id string, the eval returns the verdict.
    rpc.mockImplementation((fn: string) =>
      fn === 'fn_record_execution_decision' ? Promise.resolve('dec-h') : Promise.resolve({ summary: 'evaluated' }),
    );
    const r = await executeViaRuntime('hermes', { clow: {}, input: '', storyId: 'story-1' });
    expect(r).toMatchObject({ runtime: 'hermes', ok: true, output: 'evaluated' });
    expect(rpc).toHaveBeenCalledWith('evaluate_story_self', expect.objectContaining({ p_story_id: 'story-1' }));
    // I1 (executor axis): a decision row was minted for the hermes dispatch and threaded on.
    expect(rpc).toHaveBeenCalledWith(
      'fn_record_execution_decision',
      expect.objectContaining({ p_decision: expect.objectContaining({ runtime: 'hermes' }), p_story_id: 'story-1' }),
    );
    expect(r.detail?.decision_id).toBe('dec-h');
  });

  it('is ok:false without a storyId (cannot evaluate nothing)', async () => {
    const r = await executeViaRuntime('hermes', { clow: {}, input: '', storyId: null });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('executeViaRuntime — cli (enqueue an out-of-process agent run)', () => {
  it('enqueues via fn_spawn_claude_cli_run and returns the run_id (async dispatch)', async () => {
    rpc.mockResolvedValue('run-abc');
    const r = await executeViaRuntime('cli', {
      clow: { purpose: 'do the thing', cli_slug: 'claude-cli' },
      input: 'do the thing',
      storyId: 'story-1',
    });
    expect(r).toMatchObject({ runtime: 'cli', ok: true, output: 'run-abc' });
    expect(r.detail).toMatchObject({ run_id: 'run-abc', status: 'enqueued', async: true });
    // The governance (admission + I1 journal) lives in fn_spawn_claude_cli_run — the
    // adapter just enqueues; params alphabetical (service-security gate).
    expect(rpc).toHaveBeenCalledWith(
      'fn_spawn_claude_cli_run',
      expect.objectContaining({ p_inputs: expect.objectContaining({ prompt: 'do the thing', story_id: 'story-1' }) }),
    );
  });

  it('is ok:false when the enqueue RAISES (admission deny) — fail loud, no silent downgrade', async () => {
    rpc.mockRejectedValue(new Error('admission_deny: claude_cli_task refused — admission_denied'));
    const r = await executeViaRuntime('cli', { clow: { purpose: 'x' }, input: 'x' });
    expect(r.ok).toBe(false);
    expect(String(r.detail?.error)).toContain('admission_deny');
  });
});

describe('executeViaRuntime — unknown runtime + health', () => {
  it('throws on an unknown runtime (fail loud)', async () => {
    await expect(executeViaRuntime('bogus', { clow: {}, input: 'x' })).rejects.toThrow(/No RuntimeAdapter/i);
  });

  it('runtimeAdapterHealth reports per-adapter availability', () => {
    cfg.openclawUrl = 'http://openclaw';
    cfg.openclawApiKey = 'k';
    const health = runtimeAdapterHealth();
    expect(health).toEqual(
      expect.arrayContaining([
        { runtime: 'direct_llm', available: true },
        { runtime: 'openclaw', available: true },
        { runtime: 'hermes', available: true },
        { runtime: 'cli', available: true },
      ]),
    );
  });
});

function makeCtx(state: Record<string, unknown>): NodeContext {
  const run = {
    id: '11111111-1111-1111-1111-111111111111', kind: 'reflection', story_id: 'story-1', actor_user_id: null,
    status: 'running', workflow_definition_id: '22222222-2222-2222-2222-222222222222',
    metadata: { context: {}, input: { description: 'do the thing' } }, cost_total_json: {},
  } as unknown as RunRecord;
  return {
    run,
    workflow: { graph: { entry: '', nodes: [], edges: [] } } as unknown as WorkflowDefinitionRecord,
    node: { id: 'd', type: 'runtime_dispatch' as never, config: {} } as GraphNode,
    state,
    iteration: 1,
  };
}

describe('runtime_dispatch node', () => {
  it('executes the derived runtime and patches the output into state', async () => {
    unifiedChat.mockResolvedValue({ text: 'done', usage: { inputTokens: 1, outputTokens: 1 }, provider: 'openai', model: 'gpt-5-mini' });
    const out = await runtimeDispatch(makeCtx({ derived_runtime: 'direct_llm', clow_backend: { model_id: 'gpt-5-mini', provider_slug: 'openai' }, dispatch_input: 'go' }));
    expect(out.transition_key).toBe('executed');
    expect(out.state_patch!.runtime_used).toBe('direct_llm');
    expect(out.state_patch!.runtime_output).toBe('done');
  });

  // ⛔ 2026-09-13: provider se bral z `resolveProvider(backend.model_id)` — alias lokálního
  // modelu bez prefixu šel k openai. Teď z řádku resolveru (provider_slug + backend_kind).
  it('provider pro dispatch je z řádku resolveru, ne z prefixu id (alias lokálního modelu)', async () => {
    unifiedChat.mockResolvedValue({ text: 'lokalne', usage: { inputTokens: 1, outputTokens: 1 }, provider: 'vllm', model: 'default-lens' });
    const out = await runtimeDispatch(
      makeCtx({ derived_runtime: 'direct_llm', clow_backend: { model_id: 'default-lens', provider_slug: 'vllm-local', backend_kind: 'local_vllm' }, dispatch_input: 'go' }),
    );
    expect(out.transition_key).toBe('executed');
    expect(unifiedChat).toHaveBeenCalledWith(expect.objectContaining({ model: 'default-lens', provider: 'vllm' }));
    expect(resolveProvider).not.toHaveBeenCalledWith('default-lens');
  });

  it('⛔ provider, kterého proces neobsluhuje, runtime nespustí (žádný odhad z prefixu)', async () => {
    const out = await runtimeDispatch(
      makeCtx({ derived_runtime: 'direct_llm', clow_backend: { model_id: 'gpt-looking-id', provider_slug: 'mistral', backend_kind: 'direct_cloud' }, dispatch_input: 'go' }),
    );
    expect(out.transition_key).toBe('failed');
    expect(out.fatal_error).toMatch(/neobsluhuje/);
    expect(unifiedChat).not.toHaveBeenCalled();
  });

  it('fails loud when no runtime was derived', async () => {
    const out = await runtimeDispatch(makeCtx({ clow_backend: null }));
    expect(out.fatal_error).toContain('no derived runtime');
  });

  it('fails loud (caught) when the derived runtime adapter is unavailable', async () => {
    cfg.openclawUrl = ''; // openclaw unavailable
    const out = await runtimeDispatch(makeCtx({ derived_runtime: 'openclaw', clow_backend: null }));
    expect(out.transition_key).toBe('failed');
    expect(out.fatal_error).toContain('runtime_dispatch:');
  });
});
