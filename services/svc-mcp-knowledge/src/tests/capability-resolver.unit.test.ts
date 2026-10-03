/**
 * Unit tests for capability-resolver (Step 1.5).
 *
 * Scope: purpose→clow mapping, RPC adapter shape tolerance, TTL cache,
 * graceful-degradation contract (null on no provider, never throws).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('../postgrest.js', () => ({
  rpcService: mockRpc,
}));

import {
  resolveRagBackend,
  clearCapabilityCache,
  peekCapabilityCache,
  summarizeForAudit,
} from '../lib/capability-resolver.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockRpc.mockReset();
  clearCapabilityCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolveRagBackend — happy path', () => {
  it('maps rag.contextual_prefix to a classification CLOW and returns the resolved provider', async () => {
    mockRpc.mockResolvedValueOnce({
      provider_slug: 'vllm-prod',
      model_id: 'Qwen/Qwen3-30B',
      backend_kind: 'local_vllm',
      endpoint_url: 'http://vllm:8000/v1',
      auth_env_var: 'VLLM_API_KEY',
      cost_class: 'budget',
      health_status: 'healthy',
      overall_score: 0.87,
    });

    const result = await resolveRagBackend('rag.contextual_prefix');

    expect(result).toMatchObject({
      provider_slug: 'vllm-prod',
      model_id: 'Qwen/Qwen3-30B',
      backend_kind: 'local_vllm',
      resolved_via: 'clow_resolver',
      health_status: 'healthy',
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'aisha_resolve_clow_backend',
      expect.objectContaining({
        p_clow: expect.objectContaining({
          purpose: 'rag.contextual_prefix',
          task_kind: 'classification',
        }),
      }),
    );
  });

  it('passes budget_remaining to context (resolver may downgrade premium → budget)', async () => {
    mockRpc.mockResolvedValueOnce({
      provider_slug: 'p', model_id: 'm', backend_kind: 'direct_cloud',
      cost_class: 'budget', health_status: 'healthy',
    });

    await resolveRagBackend('rag.eval_answer', { budget_remaining: 0.05 });

    const call = mockRpc.mock.calls[0][1] as { p_context: { budget_remaining?: number } };
    expect(call.p_context.budget_remaining).toBe(0.05);
  });

  it('accepts nested "decision" key in RPC response (resolver version tolerance)', async () => {
    mockRpc.mockResolvedValueOnce({
      decision: {
        provider_slug: 'anthropic',
        model_id: 'claude-haiku-4-5',
        backend_kind: 'direct_cloud',
        endpoint_url: 'https://api.anthropic.com',
        auth_env_var: 'ANTHROPIC_API_KEY',
        health_status: 'healthy',
        overall_score: 0.92,
      },
    });

    const result = await resolveRagBackend('rag.eval_judge');
    expect(result?.provider_slug).toBe('anthropic');
    expect(result?.model_id).toBe('claude-haiku-4-5');
  });

  it('accepts nested "selected" key in RPC response', async () => {
    mockRpc.mockResolvedValueOnce({
      selected: {
        provider_slug: 'openai',
        model_id: 'gpt-4o-mini',
        backend_kind: 'direct_cloud',
        health_status: 'degraded',
      },
    });
    const result = await resolveRagBackend('rag.eval_answer');
    expect(result?.provider_slug).toBe('openai');
    expect(result?.health_status).toBe('degraded');
  });

  it('accepts the PRODUCTION { top, candidates } shape the live RPC actually returns', async () => {
    // Regression: aisha_resolve_clow_backend returns the pick under `top` (+ a
    // ranked `candidates[]`), NOT flat/decision/selected. pickFromResolution used
    // to ignore `top`, so EVERY rag.* resolution returned null in prod → /embeddings
    // 503'd ("no contextual-prefix backend"). The other mocks in this file never
    // exercised the real shape, so the bug shipped green. (live 2026-06-30)
    mockRpc.mockResolvedValueOnce({
      resolved: true,
      top: {
        provider_slug: 'google-genai',
        model_id: 'gemini-2.5-flash',
        backend_kind: 'direct_cloud',
        auth_env_var: 'GOOGLE_AI_API_KEY',
        cost_class: 'budget',
        health_status: 'unknown',
        overall_score: 0.42,
      },
      candidates: [
        { provider_slug: 'google-genai', model_id: 'gemini-2.5-flash' },
        { provider_slug: 'openai', model_id: 'gpt-5-mini' },
      ],
    });
    const result = await resolveRagBackend('rag.contextual_prefix');
    expect(result?.provider_slug).toBe('google-genai');
    expect(result?.model_id).toBe('gemini-2.5-flash');
    expect(result?.resolved_via).toBe('clow_resolver');
  });
});

describe('resolveRagBackend — graceful degradation', () => {
  it('returns null when RPC succeeds but yields no provider_slug', async () => {
    mockRpc.mockResolvedValueOnce({});
    const result = await resolveRagBackend('rag.eval_answer');
    expect(result).toBeNull();
  });

  it('returns env_fallback when RPC throws AND env var is set', async () => {
    process.env.RAG_PREFIX_MODEL = 'env-fallback-model';
    mockRpc.mockRejectedValueOnce(new Error('postgrest unreachable'));

    const result = await resolveRagBackend('rag.contextual_prefix', { no_cache: true });
    expect(result).not.toBeNull();
    expect(result!.resolved_via).toBe('env_fallback');
    expect(result!.model_id).toBe('env-fallback-model');
  });

  // ⛔ Endpoint a klíč jako PÁR ze stejného zdroje (naměřeno 2026-09-28): dřív
  // endpoint soudce dostal VLLM_API_KEY, kdykoli byl nastavený i vLLM.
  it('env_fallback: endpoint soudce nese RAG_JUDGE_API_KEY, i když je nastavený i vLLM', async () => {
    process.env.RAG_PREFIX_MODEL = 'env-fallback-model';
    process.env.RAG_JUDGE_BASE_URL = 'https://judge.example/v1';
    process.env.VLLM_GENERATION_URL = 'http://vllm.local:8000/v1';
    process.env.VLLM_API_KEY = 'vllm-key';
    mockRpc.mockRejectedValueOnce(new Error('postgrest unreachable'));

    const result = await resolveRagBackend('rag.contextual_prefix', { no_cache: true });
    expect(result?.endpoint_url).toBe('https://judge.example/v1');
    expect(result?.auth_env_var).toBe('RAG_JUDGE_API_KEY');
    delete process.env.RAG_JUDGE_BASE_URL;
    delete process.env.VLLM_GENERATION_URL;
    delete process.env.VLLM_API_KEY;
  });

  it('env_fallback: lokální vLLM bez VLLM_API_KEY se prohlásí bez autentizace (null)', async () => {
    process.env.RAG_PREFIX_MODEL = 'env-fallback-model';
    delete process.env.RAG_JUDGE_BASE_URL;
    delete process.env.VLLM_API_KEY;
    process.env.VLLM_GENERATION_URL = 'http://vllm.local:8000/v1';
    mockRpc.mockRejectedValueOnce(new Error('postgrest unreachable'));

    const result = await resolveRagBackend('rag.contextual_prefix', { no_cache: true });
    expect(result?.endpoint_url).toBe('http://vllm.local:8000/v1');
    expect(result?.auth_env_var).toBeNull();
    delete process.env.VLLM_GENERATION_URL;
  });

  it('returns null when RPC throws AND no env fallback configured', async () => {
    delete process.env.RAG_PREFIX_MODEL;
    delete process.env.VLLM_GENERATION_URL;
    delete process.env.RAG_JUDGE_BASE_URL;
    mockRpc.mockRejectedValueOnce(new Error('postgrest unreachable'));

    const result = await resolveRagBackend('rag.contextual_prefix', { no_cache: true });
    expect(result).toBeNull();
  });

  it('never throws — always returns null OR ResolvedBackend', async () => {
    mockRpc.mockRejectedValueOnce(new TypeError('weird internal'));
    await expect(resolveRagBackend('rag.eval_answer', { no_cache: true })).resolves.toBeDefined();
  });
});

describe('resolveRagBackend — caching', () => {
  it('hits cache on second call within TTL', async () => {
    mockRpc.mockResolvedValueOnce({
      provider_slug: 'p', model_id: 'm', backend_kind: 'direct_cloud',
      health_status: 'healthy', overall_score: 0.8,
    });

    const a = await resolveRagBackend('rag.eval_answer');
    const b = await resolveRagBackend('rag.eval_answer');

    expect(a?.model_id).toBe('m');
    expect(b?.model_id).toBe('m');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('separate cache key per purpose', async () => {
    mockRpc
      .mockResolvedValueOnce({ provider_slug: 'pa', model_id: 'ma', backend_kind: 'direct_cloud', health_status: 'healthy' })
      .mockResolvedValueOnce({ provider_slug: 'pj', model_id: 'mj', backend_kind: 'direct_cloud', health_status: 'healthy' });

    const a = await resolveRagBackend('rag.eval_answer');
    const j = await resolveRagBackend('rag.eval_judge');

    expect(a?.model_id).toBe('ma');
    expect(j?.model_id).toBe('mj');
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('no_cache option bypasses cached value', async () => {
    mockRpc
      .mockResolvedValueOnce({ provider_slug: 'p', model_id: 'a', backend_kind: 'direct_cloud', health_status: 'healthy' })
      .mockResolvedValueOnce({ provider_slug: 'p', model_id: 'b', backend_kind: 'direct_cloud', health_status: 'healthy' });

    const first = await resolveRagBackend('rag.eval_answer');
    const second = await resolveRagBackend('rag.eval_answer', { no_cache: true });

    expect(first?.model_id).toBe('a');
    expect(second?.model_id).toBe('b');
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('clearCapabilityCache wipes all entries', async () => {
    mockRpc.mockResolvedValue({
      provider_slug: 'p', model_id: 'm', backend_kind: 'direct_cloud', health_status: 'healthy',
    });
    await resolveRagBackend('rag.eval_answer');
    expect(peekCapabilityCache('rag.eval_answer')).not.toBeUndefined();
    clearCapabilityCache();
    expect(peekCapabilityCache('rag.eval_answer')).toBeUndefined();
  });
});

describe('summarizeForAudit', () => {
  it('emits a "resolved=false" object when input is null', () => {
    const out = summarizeForAudit(null);
    expect(out).toEqual({ resolved: false, resolved_via: 'unavailable' });
  });

  it('emits full audit fields for a resolved backend', () => {
    const out = summarizeForAudit({
      provider_slug: 'vllm',
      model_id: 'qwen3-30b',
      backend_kind: 'local_vllm',
      endpoint_url: 'http://vllm:8000',
      auth_env_var: 'VLLM_API_KEY',
      cost_class: 'budget',
      resolved_via: 'clow_resolver',
      health_status: 'healthy',
      overall_score: 0.87,
    });
    expect(out).toMatchObject({
      resolved: true,
      resolved_via: 'clow_resolver',
      resolved_provider_slug: 'vllm',
      resolved_model_id: 'qwen3-30b',
      resolved_backend_kind: 'local_vllm',
      resolved_health_status: 'healthy',
      resolved_overall_score: 0.87,
    });
  });
});

describe('resolveRagBackend — odysseus purposes (impl/12 §B-8)', () => {
  // New purposes are DATA (union + CLOW map entry), not components: they must
  // route through aisha_resolve_clow_backend exactly like the rag.* family,
  // with no DB migration (impl/08 §3.6).
  it('chat.history_compaction maps to a chat CLOW (compact summary, local-friendly)', async () => {
    mockRpc.mockResolvedValueOnce({
      provider_slug: 'vllm-prod', model_id: 'Qwen/Qwen3-30B',
      backend_kind: 'local_vllm', health_status: 'healthy', overall_score: 0.8,
    });

    const result = await resolveRagBackend('chat.history_compaction');

    expect(result?.provider_slug).toBe('vllm-prod');
    expect(mockRpc).toHaveBeenCalledWith(
      'aisha_resolve_clow_backend',
      expect.objectContaining({
        p_clow: expect.objectContaining({
          purpose: 'chat.history_compaction',
          task_kind: 'chat',
          allow_local: true,
        }),
      }),
    );
  });

  it('research.reasoning maps to a reasoning CLOW; research.extract to a batchable extraction CLOW', async () => {
    mockRpc.mockResolvedValue({
      provider_slug: 'anthropic', model_id: 'claude-sonnet-5',
      backend_kind: 'direct_cloud', health_status: 'healthy',
    });

    await resolveRagBackend('research.reasoning', { no_cache: true });
    await resolveRagBackend('research.extract', { no_cache: true });

    const kinds = mockRpc.mock.calls.map(
      (c) => (c[1] as { p_clow: { purpose: string; task_kind: string; allow_batch?: boolean } }).p_clow,
    );
    expect(kinds[0]).toMatchObject({ purpose: 'research.reasoning', task_kind: 'reasoning' });
    expect(kinds[1]).toMatchObject({ purpose: 'research.extract', task_kind: 'extraction', allow_batch: true });
  });

  it('new purposes have env fallbacks for developer-local bootstrap', async () => {
    process.env.CHAT_COMPACTION_MODEL = 'local-compactor';
    mockRpc.mockRejectedValueOnce(new Error('postgrest unreachable'));

    const result = await resolveRagBackend('chat.history_compaction', { no_cache: true });

    expect(result?.resolved_via).toBe('env_fallback');
    expect(result?.model_id).toBe('local-compactor');
    delete process.env.CHAT_COMPACTION_MODEL;
  });

  it('caches per purpose — compaction and research resolutions do not collide', async () => {
    mockRpc
      .mockResolvedValueOnce({ provider_slug: 'a', model_id: 'm1', backend_kind: 'direct_cloud', health_status: 'healthy' })
      .mockResolvedValueOnce({ provider_slug: 'b', model_id: 'm2', backend_kind: 'direct_cloud', health_status: 'healthy' });

    const first = await resolveRagBackend('chat.history_compaction');
    const second = await resolveRagBackend('research.reasoning');
    expect(first?.model_id).toBe('m1');
    expect(second?.model_id).toBe('m2');
    expect(peekCapabilityCache('chat.history_compaction')?.model_id).toBe('m1');
    expect(peekCapabilityCache('research.reasoning')?.model_id).toBe('m2');
  });
});
