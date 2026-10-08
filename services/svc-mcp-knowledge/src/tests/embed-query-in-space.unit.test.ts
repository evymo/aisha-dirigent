/**
 * Unit tests for embed-query-in-space (Brick2-PIN).
 *
 * Scope: the query-embedding seam that pins retrieval to the corpus's index model.
 * Network-free — the embed-dispatcher and the postgrest RPC adapter are stubbed, so
 * no HTTP / DB call happens. Pins the load-bearing invariants:
 *   - the resolved backend.rag_space decides which v3 arm carries the vector: a v2
 *     (2560) space ⇒ queryEmbeddingV2 set + V1 null; a v1 (1536) space ⇒ the reverse
 *     (so v3 NEVER cosine-compares across embedding spaces).
 *   - the backend.model_id (the Brick2-guard p_query_model identity) is threaded
 *     through to the embed() call and surfaced on the result.
 *   - an embed failure PROPAGATES (the caller fails loud — no text-only fallback since P2
 *     2026-10-06 — never silently embeds with a different-space model).
 *   - the space/named resolvers fail loud when nothing resolves (no substitution).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmbed = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

const mockIdentita = vi.hoisted(() => ({ hodnota: null as null | { identita: string; revize: string | null; recept: string } }));

vi.mock('../lib/embed-dispatcher.js', () => ({
  embed: mockEmbed,
  // Kód pod testem volá embedSIdentitou; vektory dál dodává mockEmbed (stávající tvrzení platí),
  // identitu vah test nastaví zvlášť.
  embedSIdentitou: async (opts: unknown) => ({ vectors: await mockEmbed(opts), identita: mockIdentita.hodnota }),
  // mapBackendKind is pure; re-export a faithful stand-in so the module under test
  // can call it without pulling the real dispatcher (keeps this test network-free).
  mapBackendKind: (kind: string) =>
    kind === 'local_ollama'
      ? 'ollama'
      : kind === 'local_vllm'
        ? 'local_vllm'
        : kind === 'llm_gateway'
          ? 'openai'
          : 'direct_cloud',
}));

// Čtečka pověření (2026-10-02): v testu trezor = prostředí procesu (tvar createCredentialReader).
vi.mock('../lib/credentials.js', () => ({
  credentials: () => ({ get: async (n: string) => process.env[n] ?? null }),
}));
vi.mock('../postgrest.js', () => ({
  rpcService: mockRpc,
}));

import {
  embedQueryWithBackend,
  embedQueryWithNamedModel,
  embedQueryForProfile,
  type EmbeddingBackend,
} from '../lib/embed-query-in-space.js';
import { EmbeddingSpaceUnresolvedError } from '../lib/knowledge-search-unavailable.js';

const VEC_V1 = Array.from({ length: 4 }, (_, i) => i / 10); // stand-in vector
const VEC_V2 = Array.from({ length: 6 }, (_, i) => (i + 1) / 10);

function backend(over: Partial<EmbeddingBackend> = {}): EmbeddingBackend {
  return {
    model_id: 'mg-embed-1536',
    provider_slug: 'mg-prov-v1',
    backend_kind: 'direct_cloud',
    endpoint_url: 'https://v1.example.invalid',
    auth_env_var: null,
    embedding_dimensions: 1536,
    rag_space: 'v1',
    ...over,
  };
}

beforeEach(() => {
  mockEmbed.mockReset();
  mockRpc.mockReset();
  mockIdentita.hodnota = null;
});

describe('embedQueryWithBackend — space branching + model-id threading', () => {
  it('a v1 (1536) space puts the vector on queryEmbeddingV1 and leaves V2 null', async () => {
    mockEmbed.mockResolvedValueOnce([VEC_V1]);
    const out = await embedQueryWithBackend(backend({ rag_space: 'v1' }), 'how do refunds work?', 'dotaz');

    expect(out.ragSpace).toBe('v1');
    expect(out.queryEmbeddingV1).toEqual(VEC_V1);
    expect(out.queryEmbeddingV2).toBeNull();
  });

  it('a v2 (2560) space puts the vector on queryEmbeddingV2 and leaves V1 null', async () => {
    mockEmbed.mockResolvedValueOnce([VEC_V2]);
    const out = await embedQueryWithBackend(
      backend({ rag_space: 'v2', model_id: 'mg-embed-2560', embedding_dimensions: 2560 }),
      'how do refunds work?',
      'dotaz',
    );

    expect(out.ragSpace).toBe('v2');
    expect(out.queryEmbeddingV2).toEqual(VEC_V2);
    expect(out.queryEmbeddingV1).toBeNull();
  });

  it('threads the backend model_id + dimensions through to embed() and surfaces the backend', async () => {
    mockEmbed.mockResolvedValueOnce([VEC_V2]);
    const b = backend({ rag_space: 'v2', model_id: 'mg-embed-2560', embedding_dimensions: 2560, backend_kind: 'local_vllm' });
    const out = await embedQueryWithBackend(b, 'q', 'dotaz');

    // The Brick2-guard p_query_model identity is the resolved model_id, surfaced verbatim.
    expect(out.backend.model_id).toBe('mg-embed-2560');
    // embed() was called with that exact model + the corpus dimension + mapped backend kind.
    const call = mockEmbed.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.model).toBe('mg-embed-2560');
    expect(call.dimensions).toBe(2560);
    expect(call.backendKind).toBe('local_vllm');
    expect(call.texts).toEqual(['q']);
    expect(call.trida).toBe('dotaz');
  });

  it('identita vah, která dotaz spočítala, se vrátí k dotazu (E4: srovnání s korpusem)', async () => {
    mockEmbed.mockResolvedValueOnce([VEC_V1]);
    mockIdentita.hodnota = { identita: `gguf:${'b'.repeat(64)}`, revize: null, recept: 'mean' };
    const out = await embedQueryWithBackend(backend({ backend_kind: 'local_vllm' }), 'q', 'dotaz');
    expect(out.identita).toEqual(mockIdentita.hodnota);
  });

  it('reads the API key from the backend.auth_env_var when set (none otherwise)', async () => {
    mockEmbed.mockResolvedValue([VEC_V1]);
    process.env.MG_TEST_EMBED_KEY = 'sk-mg-test';
    await embedQueryWithBackend(backend({ auth_env_var: 'MG_TEST_EMBED_KEY' }), 'q', 'dotaz');
    expect((mockEmbed.mock.calls[0]?.[0] as Record<string, unknown>).apiKey).toBe('sk-mg-test');
    delete process.env.MG_TEST_EMBED_KEY;

    mockEmbed.mockResolvedValue([VEC_V1]);
    await embedQueryWithBackend(backend({ auth_env_var: null }), 'q', 'dotaz');
    expect((mockEmbed.mock.calls[1]?.[0] as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it('PROPAGATES an embed failure (caller fails loud / degrades — never substitutes)', async () => {
    mockEmbed.mockRejectedValueOnce(new Error('embed provider returned 503 (direct_cloud)'));
    await expect(embedQueryWithBackend(backend(), 'q', 'dotaz')).rejects.toThrow(/503/);
  });
});

describe('embedQueryForProfile — resolves the corpus-space model then embeds in it', () => {
  it('passes the profile slug + fallback space to the space resolver and embeds in v2', async () => {
    mockRpc.mockResolvedValueOnce([backend({ rag_space: 'v2', model_id: 'mg-embed-2560', embedding_dimensions: 2560 })]);
    mockEmbed.mockResolvedValueOnce([VEC_V2]);

    const out = await embedQueryForProfile('q', 'cs-support', 'v1');

    expect(out.ragSpace).toBe('v2');
    expect(out.queryEmbeddingV2).toEqual(VEC_V2);
    // produkční hledání = interaktivní dotaz
    expect((mockEmbed.mock.calls[0]?.[0] as Record<string, unknown>).trida).toBe('dotaz');
    expect(mockRpc).toHaveBeenCalledWith('fn_resolve_embedding_model_for_space', {
      p_context_profile_slug: 'cs-support',
      p_rag_space: 'v1',
    });
  });

  it('THROWS a typed EmbeddingSpaceUnresolvedError when no model resolves (caller fails loud)', async () => {
    mockRpc.mockResolvedValueOnce([]); // empty ⇒ no live embedding backend
    const chyba = await embedQueryForProfile('q', 'no-such-profile').catch((e: unknown) => e);
    expect(chyba).toBeInstanceOf(EmbeddingSpaceUnresolvedError);
    expect(String((chyba as Error).message)).toMatch(/fail loud, no text fallback/);
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});

describe('embedQueryWithNamedModel — resolves a NAMED model then embeds with it', () => {
  it('passes the model id to the named resolver and embeds with the resolved backend', async () => {
    mockRpc.mockResolvedValueOnce([backend({ model_id: 'mg-embed-1536', rag_space: 'v1' })]);
    mockEmbed.mockResolvedValueOnce([VEC_V1]);

    const out = await embedQueryWithNamedModel('mg-embed-1536', 'q');

    expect(out.backend.model_id).toBe('mg-embed-1536');
    expect(out.queryEmbeddingV1).toEqual(VEC_V1);
    expect(mockRpc).toHaveBeenCalledWith('fn_resolve_embedding_model', { p_model_id: 'mg-embed-1536' });
  });

  it('THROWS when the named model is unresolvable (fail loud — never substitute)', async () => {
    mockRpc.mockResolvedValueOnce([]);
    await expect(embedQueryWithNamedModel('ghost-model', 'q')).rejects.toThrow(/not resolvable/);
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
