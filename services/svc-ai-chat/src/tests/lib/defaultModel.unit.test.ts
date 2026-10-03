/**
 * Unit: resolveDefaultModel — the platform default is a LIVE AISHA resolve, never a
 * hardcoded model id. Asserts (a) it returns the resolver-picked model_id over the
 * live serviceable pool, (b) it FAILS LOUD (throws) when the pool is empty or the
 * resolver yields nothing — no `gpt-5-mini` literal anywhere (the no-fallbacks rule).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcServiceMock = vi.hoisted(() => vi.fn());
const selectServiceableSlugsMock = vi.hoisted(() => vi.fn());
vi.mock('../../postgrest.js', () => ({ rpcService: rpcServiceMock }));
vi.mock('../../lib/llmRouter.js', () => ({ selectServiceableSlugs: selectServiceableSlugsMock }));

import { resolveDefaultBackend, resolveDefaultModel } from '../../lib/defaultModel.js';

describe('resolveDefaultModel — default is a live AISHA resolve, never a literal', () => {
  beforeEach(() => {
    rpcServiceMock.mockReset();
    selectServiceableSlugsMock.mockReset();
  });

  it('returns the resolver-picked model_id over the live serviceable pool', async () => {
    selectServiceableSlugsMock.mockReturnValue(['openai', 'anthropic']);
    rpcServiceMock.mockImplementation((fn: string) => {
      if (fn === 'derive_clow_needs') return Promise.resolve({ needs_tools: false });
      if (fn === 'aisha_resolve_clow_backend') return Promise.resolve({ resolved: true, top: { model_id: 'claude-sonnet-4-x' } });
      return Promise.resolve(null);
    });

    expect(await resolveDefaultModel('chat')).toBe('claude-sonnet-4-x');
    expect(rpcServiceMock).toHaveBeenCalledWith(
      'aisha_resolve_clow_backend',
      expect.objectContaining({ p_context: expect.objectContaining({ serviceable_slugs: ['openai', 'anthropic'] }) }),
    );
  });

  it('FAILS LOUD when the serviceable pool is empty (no literal fallback, no RPC)', async () => {
    selectServiceableSlugsMock.mockReturnValue([]);
    await expect(resolveDefaultModel()).rejects.toThrow(/no serviceable backend/i);
    expect(rpcServiceMock).not.toHaveBeenCalled();
  });

  it('localOnly forces an on-prem resolve (cloud_forbidden) — for the local-mode tier floors', async () => {
    selectServiceableSlugsMock.mockReturnValue(['ollama-local']);
    rpcServiceMock.mockImplementation((fn: string) =>
      fn === 'aisha_resolve_clow_backend' ? Promise.resolve({ resolved: true, top: { model_id: 'llama-3.1-8b' } }) : Promise.resolve({}),
    );
    expect(await resolveDefaultModel('chat', { localOnly: true })).toBe('llama-3.1-8b');
    expect(rpcServiceMock).toHaveBeenCalledWith(
      'aisha_resolve_clow_backend',
      expect.objectContaining({ p_clow: expect.objectContaining({ cloud_forbidden: true }) }),
    );
  });

  it('FAILS LOUD when the resolver returns no model (pool unhealthy)', async () => {
    selectServiceableSlugsMock.mockReturnValue(['openai']);
    rpcServiceMock.mockImplementation((fn: string) =>
      fn === 'aisha_resolve_clow_backend' ? Promise.resolve({ resolved: false, top: null }) : Promise.resolve({}),
    );
    await expect(resolveDefaultModel()).rejects.toThrow(/no serviceable chat model/i);
  });

  it('still resolves when derive_clow_needs fails (advisory, non-fatal)', async () => {
    selectServiceableSlugsMock.mockReturnValue(['anthropic']);
    rpcServiceMock.mockImplementation((fn: string) => {
      if (fn === 'derive_clow_needs') return Promise.reject(new Error('rpc down'));
      if (fn === 'aisha_resolve_clow_backend') return Promise.resolve({ resolved: true, top: { model_id: 'm-1' } });
      return Promise.resolve(null);
    });
    expect(await resolveDefaultModel()).toBe('m-1');
  });
});

// ⛔ 2026-09-13: kdo výchozí model rovnou dispatchuje, potřebuje i PROVIDERA — a ten patří
// z řádku resolveru. `resolveProvider(model)` z prefixu poslal model bez prefixu k openai.
describe('resolveDefaultBackend — model I provider z řádku resolveru', () => {
  beforeEach(() => {
    rpcServiceMock.mockReset();
    selectServiceableSlugsMock.mockReset();
    selectServiceableSlugsMock.mockReturnValue(['vllm-local', 'openai']);
  });

  const resolverVraci = (top: Record<string, unknown> | null) =>
    rpcServiceMock.mockImplementation((fn: string) =>
      fn === 'aisha_resolve_clow_backend' ? Promise.resolve({ resolved: !!top, top }) : Promise.resolve({}),
    );

  it('alias lokálního modelu bez prefixu → provider vllm (z backend_kind/slugu), ne openai', async () => {
    resolverVraci({ model_id: 'default-lens', provider_slug: 'vllm-local', backend_kind: 'local_vllm' });
    expect(await resolveDefaultBackend('chat.history_compaction')).toEqual({ model: 'default-lens', provider: 'vllm' });
  });

  it('model za llm_gateway (slug llmgateway-io) → gateway', async () => {
    resolverVraci({ model_id: 'deepseek-chat', provider_slug: 'llmgateway-io', backend_kind: 'llm_gateway' });
    expect(await resolveDefaultBackend()).toEqual({ model: 'deepseek-chat', provider: 'gateway' });
  });

  it('slug ve tvaru registru (google-genai) → google', async () => {
    resolverVraci({ model_id: 'gemini-x', provider_slug: 'google-genai', backend_kind: 'direct_cloud' });
    expect((await resolveDefaultBackend()).provider).toBe('google');
  });

  it('⛔ negativní sonda: provider, kterého proces neobsluhuje, je chyba — ne odhad z id', async () => {
    resolverVraci({ model_id: 'gpt-looking-id', provider_slug: 'mistral', backend_kind: 'direct_cloud' });
    await expect(resolveDefaultBackend()).rejects.toThrow(/neobsluhuje/);
  });

  it('resolveDefaultModel se nezměnil — vrací jen id, i u řádku bez slugu', async () => {
    resolverVraci({ model_id: 'm-bez-slugu' });
    expect(await resolveDefaultModel()).toBe('m-bez-slugu');
  });
});
