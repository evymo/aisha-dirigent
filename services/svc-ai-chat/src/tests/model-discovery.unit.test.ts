/**
 * Model discovery — the discover→registry wiring. Locks that every configured
 * backend's live model list is upserted into ai_model_registry (no static roster),
 * and that one failing backend never blocks the others.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { discoverModels, deriveModelCaps, repeatAfterCompletion, type DiscoveryRpc } from '../lib/modelDiscovery.js';

const backend = (id: string, models?: string[], fail?: boolean) => ({
  id,
  healthCheck: async () => {
    if (fail) throw new Error('unreachable');
    return { models };
  },
});

describe('discoverModels — discover→registry from live key truth', () => {
  it('upserts every model of every configured backend (provider id passed for slug-normalization)', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const rpc: DiscoveryRpc = async (_fn, args) => {
      calls.push(args);
      return null;
    };
    const res = await discoverModels(rpc, [
      backend('openai', ['gpt-5-mini', 'gpt-4o']),
      backend('google', ['gemini-2.5-flash']),
    ]);

    expect(res.discovered).toBe(3);
    expect(res.perProvider).toEqual({ openai: 2, google: 1 });
    expect(res.errors).toEqual([]);
    // each upsert names the registry RPC with the provider id + model id AND the
    // derived capability metadata (so the model is resolvable by the caps gates).
    expect(calls).toContainEqual(
      expect.objectContaining({ p_model_id: 'gpt-5-mini', p_provider: 'openai', p_is_chat_capable: true }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ p_model_id: 'gemini-2.5-flash', p_provider: 'google', p_is_chat_capable: true }),
    );
    // Capability metadata is present on every upsert (chat default + derived flags).
    for (const c of calls) {
      expect(c).toHaveProperty('p_is_chat_capable', true);
      expect(c).toHaveProperty('p_is_embedding', false); // all three ids are chat models
      expect(c).toHaveProperty('p_is_function_calling');
      expect(c).toHaveProperty('p_is_reasoning');
      expect(c).toHaveProperty('p_is_vision');
    }
  });

  it('threads is_embedding through to the upsert RPC for a discovered embedding model', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const rpc: DiscoveryRpc = async (_fn, args) => { calls.push(args); return null; };
    await discoverModels(rpc, [backend('openai', ['text-embedding-3-small'])]);
    expect(calls).toContainEqual(
      expect.objectContaining({
        p_model_id: 'text-embedding-3-small',
        p_is_embedding: true,
        p_is_chat_capable: false,
      }),
    );
  });

  it('is soft per-backend — one unreachable provider does not block the others', async () => {
    const rpc: DiscoveryRpc = async () => null;
    const res = await discoverModels(rpc, [
      backend('anthropic', undefined, true), // healthCheck throws
      backend('openai', ['gpt-4o']),
    ]);

    expect(res.discovered).toBe(1);
    expect(res.perProvider).toEqual({ openai: 1 });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].provider).toBe('anthropic');
  });

  it('discovers nothing when no backend is configured (empty registry → empty result, never throws)', async () => {
    const rpc: DiscoveryRpc = async () => null;
    const res = await discoverModels(rpc, []);
    expect(res).toEqual({
      discovered: 0,
      perProvider: {},
      errors: [],
      markedUnavailable: {},
      availabilityUnmeasured: [],
      measuredEmbeddingDimensions: {},
    });
  });
});

describe('discoverModels — dostupnost z ÚPLNÉHO živého listingu (mark_models_unavailable)', () => {
  const zaznam = () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const rpc: DiscoveryRpc = async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'mark_models_unavailable') return 2;
      return { is_new: false, was_unavailable: false, embedding_dimensions: null };
    };
    return { calls, rpc };
  };

  it('⛔ úplný listing: co v něm není, se vede jako nedostupné (provider + živý seznam)', async () => {
    // Naměřeno 2026-09-13: mark_models_unavailable nevolal nikdo → seedované vLLM řádky
    // zůstávaly dostupné, ačkoli je nic neobsluhovalo.
    const { calls, rpc } = zaznam();
    const res = await discoverModels(rpc, [
      { id: 'vllm', healthCheck: async () => ({ available: true, models: ['default-lens'], modelsComplete: true }) },
    ]);
    const mark = calls.find((c) => c.fn === 'mark_models_unavailable');
    expect(mark?.args).toEqual({ p_provider: 'vllm', p_available_model_ids: ['default-lens'] });
    expect(res.markedUnavailable).toEqual({ vllm: 2 });
    expect(res.availabilityUnmeasured).toEqual([]);
  });

  it('úplný PRÁZDNÝ listing je měření „nic se neobsluhuje" (prázdné pole, ne vynechání)', async () => {
    const { calls, rpc } = zaznam();
    await discoverModels(rpc, [{ id: 'vllm', healthCheck: async () => ({ available: true, modelsComplete: true }) }]);
    expect(calls.find((c) => c.fn === 'mark_models_unavailable')?.args.p_available_model_ids).toEqual([]);
  });

  it('⛔ neúplný (stránkovaný) listing dostupnost NEMĚŘÍ — nic se neoznačí', async () => {
    const { calls, rpc } = zaznam();
    const res = await discoverModels(rpc, [
      { id: 'anthropic', healthCheck: async () => ({ available: true, models: ['claude-a'] }) },
    ]);
    expect(calls.some((c) => c.fn === 'mark_models_unavailable')).toBe(false);
    expect(res.availabilityUnmeasured).toEqual(['anthropic']);
  });

  it('⛔ nedostupný nebo padající backend dostupnost NEMĚŘÍ („Tool failure ≠ data")', async () => {
    const { calls, rpc } = zaznam();
    const res = await discoverModels(rpc, [
      { id: 'vllm', healthCheck: async () => ({ available: false, modelsComplete: true }) },
      { id: 'ollama', healthCheck: async () => { throw new Error('ECONNREFUSED'); } },
    ]);
    expect(calls.some((c) => c.fn === 'mark_models_unavailable')).toBe(false);
    expect(res.availabilityUnmeasured.sort()).toEqual(['ollama', 'vllm']);
  });
});

describe('discoverModels — rozměr embedding modelu se MĚŘÍ při objevení', () => {
  it('nový embedding model: sonda změří rozměr a zapíše ho (p_embedding_dimensions)', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const rpc: DiscoveryRpc = async (fn, args) => {
      calls.push({ fn, args });
      return { is_new: true, was_unavailable: false, embedding_dimensions: null };
    };
    const probe = vi.fn(async () => 1024);
    const res = await discoverModels(rpc, [
      { id: 'vllm', healthCheck: async () => ({ available: true, models: ['lens-embedding'] }), embeddingDimension: probe },
    ]);
    expect(probe).toHaveBeenCalledWith('lens-embedding');
    const zapis = calls.filter((c) => c.fn === 'upsert_discovered_model' && c.args.p_embedding_dimensions !== undefined);
    expect(zapis).toHaveLength(1);
    expect(zapis[0].args).toMatchObject({ p_provider: 'vllm', p_model_id: 'lens-embedding', p_embedding_dimensions: 1024, p_is_embedding: true });
    expect(res.measuredEmbeddingDimensions).toEqual({ 'vllm/lens-embedding': 1024 });
  });

  it('známý, souvisle dostupný model s rozměrem se znovu NEsonduje (CPU embedding je drahý)', async () => {
    const rpc: DiscoveryRpc = async () => ({ is_new: false, was_unavailable: false, embedding_dimensions: 1024 });
    const probe = vi.fn(async () => 1024);
    await discoverModels(rpc, [
      { id: 'vllm', healthCheck: async () => ({ available: true, models: ['lens-embedding'] }), embeddingDimension: probe },
    ]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('model, který se ZNOVU objevil, se změří znovu (pod aliasem mohl přibýt jiný build)', async () => {
    const rpc: DiscoveryRpc = async () => ({ is_new: false, was_unavailable: true, embedding_dimensions: 1024 });
    const probe = vi.fn(async () => 2560);
    const res = await discoverModels(rpc, [
      { id: 'vllm', healthCheck: async () => ({ available: true, models: ['lens-embedding'] }), embeddingDimension: probe },
    ]);
    expect(res.measuredEmbeddingDimensions).toEqual({ 'vllm/lens-embedding': 2560 });
  });

  it('⛔ selhání sondy je chyba, nikdy rozměr; chat model se nesonduje', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const rpc: DiscoveryRpc = async (fn, args) => {
      calls.push({ fn, args });
      return { is_new: true, was_unavailable: false, embedding_dimensions: null };
    };
    const probe = vi.fn(async (m: string) => {
      if (m === 'lens-embedding') throw new Error('timeout');
      return 1;
    });
    const res = await discoverModels(rpc, [
      { id: 'vllm', healthCheck: async () => ({ available: true, models: ['lens-embedding', 'default-lens'] }), embeddingDimension: probe },
    ]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.args.p_embedding_dimensions !== undefined)).toBe(false);
    expect(res.errors[0]).toMatchObject({ provider: 'vllm' });
    expect(res.errors[0].error).toMatch(/embedding dimension lens-embedding/);
  });
});

describe('repeatAfterCompletion — periodická discovery se nepřekrývá a nezastaví', () => {
  it('další průchod se plánuje až PO dokončení předchozího; chyba smyčku nezastaví', async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      let resolveCurrent: (() => void) | undefined;
      const task = () =>
        new Promise<void>((resolve, reject) => {
          runs += 1;
          if (runs === 2) reject(new Error('průchod selhal'));
          else resolveCurrent = resolve;
        });
      const errors: unknown[] = [];
      const loop = repeatAfterCompletion(task, 1000, (e) => errors.push(e));

      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toBe(1);
      // Průchod 1 ještě běží — ani po dalších intervalech nesmí startovat druhý.
      await vi.advanceTimersByTimeAsync(5000);
      expect(runs).toBe(1);

      resolveCurrent?.();
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toBe(2); // selže
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toBe(3); // smyčka žije dál
      expect(errors).toHaveLength(1);

      loop.stop();
      resolveCurrent?.();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(runs).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('deriveModelCaps — id-derived capabilities (conservative, never a roster)', () => {
  it('every CHAT model is chat-capable + function-calling by default', () => {
    for (const id of ['gpt-4o-mini', 'grok-2', 'gemini-2.5-flash', 'some-unknown-model']) {
      const c = deriveModelCaps(id);
      expect(c.is_chat_capable).toBe(true);
      expect(c.is_function_calling).toBe(true);
    }
  });

  it('flags NON-chat models (embedding/audio/image/legacy) as not chat-capable + not function-calling', () => {
    for (const id of ['tts-1', 'whisper-1', 'text-embedding-3-small', 'dall-e-3', 'text-davinci-003', 'babbage-002', 'gpt-4o-realtime-preview', 'omni-moderation-latest']) {
      const c = deriveModelCaps(id);
      expect(c.is_chat_capable).toBe(false);
      expect(c.is_function_calling).toBe(false);
    }
  });

  it('flags embedding models via is_embedding (symmetric capability, not a roster)', () => {
    expect(deriveModelCaps('text-embedding-3-small').is_embedding).toBe(true);
    expect(deriveModelCaps('text-embedding-3-large').is_embedding).toBe(true);
    // a chat model is NOT an embedding model.
    expect(deriveModelCaps('gpt-4o').is_embedding).toBe(false);
    expect(deriveModelCaps('gpt-4o').is_chat_capable).toBe(true);
  });

  it('flags reasoning models from cross-provider id markers', () => {
    expect(deriveModelCaps('o3-mini').is_reasoning).toBe(true);       // openai reasoning class
    expect(deriveModelCaps('gpt-5').is_reasoning).toBe(true);
    expect(deriveModelCaps('grok-4').is_reasoning).toBe(true);
    expect(deriveModelCaps('deepseek-r1').is_reasoning).toBe(true);
    expect(deriveModelCaps('gpt-4o-mini').is_reasoning).toBe(false);  // plain chat model
  });

  it('flags vision + code from id markers', () => {
    expect(deriveModelCaps('gpt-4o').is_vision).toBe(true);
    expect(deriveModelCaps('grok-2-vision').is_vision).toBe(true);
    expect(deriveModelCaps('qwen2.5-coder-7b').is_code_optimized).toBe(true);
    expect(deriveModelCaps('mistral-7b').is_vision).toBe(false);
    expect(deriveModelCaps('mistral-7b').is_code_optimized).toBe(false);
  });
});
