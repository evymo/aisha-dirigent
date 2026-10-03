/**
 * Integration tests for POST /embeddings/v2-backfill (RAG Brick 0b).
 *
 * The v2 (Qwen3 halfvec(2560)) write path had NO runtime producer — this route is it.
 * Pins the call chain with all external deps mocked: fn_get_embeddings_needing_v2 →
 * resolveEmbeddingBackendForSpace('v2') → embed() → insert_knowledge_embedding_v2_audited.
 *
 * ⛔ 2026-09-13: model pro sloupec embedding_v2 vybírá resolver PROSTORU
 * (fn_resolve_embedding_model_for_space), ne CLOW resolver — ten rozměr neřešil a s 1024
 * i 2560 modelem dostupnými mohl téhle dráze vydat model špatného prostoru.
 * A regression (missing backend not 503'd, wrong RPC name/params, swapped success/fail
 * counting) would silently leave the multilingual v2 space empty.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let Fastify: typeof import('fastify').default | null = null;
try {
  Fastify = (await import('fastify')).default;
} catch {
  Fastify = null;
}
const describeIfFastify = Fastify ? describe : describe.skip;

const verifyServiceRoleMock = vi.hoisted(() => vi.fn());
vi.mock('../auth.js', () => ({ verifyServiceRole: verifyServiceRoleMock, AuthError: class extends Error {} }));

const rpcServiceMock = vi.hoisted(() => vi.fn());
vi.mock('../postgrest.js', () => ({ rpcService: rpcServiceMock }));

const resolveRagBackendMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/capability-resolver.js', () => ({ resolveRagBackend: resolveRagBackendMock }));

// Resolver prostoru jde přes rpcService('fn_resolve_embedding_model_for_space') — mock RPC
// ho obslouží; embed-query-in-space zůstává SKUTEČNÝ (i jeho kontrola rozměru).

const embedMock = vi.hoisted(() => vi.fn());
// Keep the REAL mapBackendKind (+ EmbedDispatchError) — brick1 moved mapBackendKind into this module,
// so a bare {embed} mock leaves the route calling an undefined mapBackendKind → 500. Only embed is stubbed.
vi.mock('../lib/embed-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/embed-dispatcher.js')>();
  return { ...actual, embed: embedMock };
});

// Imported by sibling handlers in the same module — stub so the import resolves.
vi.mock('../lib/rule-embedding-text.js', () => ({ composeRuleEmbeddingText: vi.fn() }));
vi.mock('../lib/contextual-prefix.js', () => ({ generateContextualPrefix: vi.fn() }));
vi.mock('../lib/ingestion-safety.js', () => ({ scanForInjection: vi.fn(() => ({ safe: true })) }));

const FAKE_BACKEND = {
  provider_slug: 'qwen-local',
  model_id: 'Qwen3-Embedding-4B',
  backend_kind: 'local_vllm' as const,
  endpoint_url: 'http://vllm:8000/v1',
  auth_env_var: null,
  // Rozměr NEvyplněný — kontrola délky se pak neuplatní a test drží jen řetěz volání.
  embedding_dimensions: null,
  rag_space: 'v2',
};

/** RPC mock: prostor v2 → FAKE_BACKEND (nebo nic); ostatní volání deleguje. */
function spaceRpc(backendRow: typeof FAKE_BACKEND | null, other: (fn: string) => unknown) {
  return async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'fn_resolve_embedding_model_for_space') {
      expect(args.p_rag_space, 'v2 backfill musí žádat model prostoru v2').toBe('v2');
      return backendRow ? [backendRow] : [];
    }
    return other(fn);
  };
}

async function buildApp() {
  const app = Fastify!();
  const { knowledgeEmbeddingsRoutes } = await import('../routes/knowledge-embeddings.js');
  await app.register(knowledgeEmbeddingsRoutes);
  await app.ready();
  return app;
}

describeIfFastify('POST /embeddings/v2-backfill', () => {
  beforeEach(() => {
    verifyServiceRoleMock.mockReset().mockReturnValue(undefined);
    rpcServiceMock.mockReset();
    resolveRagBackendMock.mockReset();
    embedMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('503s with a populate hint when no embedding backend resolves', async () => {
    rpcServiceMock.mockImplementation(spaceRpc(null, (fn) =>
      fn === 'fn_get_embeddings_needing_v2'
        ? [{ embedding_id: 'e1', chunk_id: 'c1', knowledge_item_id: 'k1', chunk_text: 'hello', contextual_prefix: null }]
        : undefined,
    ));

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/embeddings/v2-backfill', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json().hint).toMatch(/fn_resolve_embedding_model_for_space\(v2\)/);
    expect(resolveRagBackendMock, 'CLOW resolver rozměr neřeší — pro zápis se nesmí použít').not.toHaveBeenCalled();
    expect(embedMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('short-circuits when nothing needs a v2 embedding', async () => {
    rpcServiceMock.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/embeddings/v2-backfill', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 0, generated: 0, failed: 0 });
    expect(resolveRagBackendMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('embeds via the resolved model and writes each row through the halfvec text wrapper', async () => {
    rpcServiceMock.mockImplementation(spaceRpc(FAKE_BACKEND, (fn) => {
      if (fn === 'fn_get_embeddings_needing_v2') {
        return [
          { embedding_id: 'e1', chunk_id: 'c1', knowledge_item_id: 'k1', chunk_text: 'alpha', contextual_prefix: 'CTX' },
          { embedding_id: 'e2', chunk_id: 'c2', knowledge_item_id: 'k1', chunk_text: 'beta', contextual_prefix: null },
        ];
      }
      return undefined; // insert_knowledge_embedding_v2_audited
    }));
    embedMock.mockResolvedValue([[0.1, 0.2, 0.3]]);

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/embeddings/v2-backfill', payload: { batch_size: 10 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 2, generated: 2, failed: 0, model: 'Qwen3-Embedding-4B', via: 'space_resolver' });

    // embed() got the resolver model + the contextual prefix prepended for row 1.
    expect(embedMock).toHaveBeenCalledTimes(2);
    expect(embedMock.mock.calls[0][0]).toMatchObject({ model: 'Qwen3-Embedding-4B', backendKind: 'local_vllm', texts: ['CTX alpha'] });
    expect(embedMock.mock.calls[1][0]).toMatchObject({ texts: ['beta'] });

    // each row written via the unambiguous text wrapper, not the ambiguous audited overloads.
    const writes = rpcServiceMock.mock.calls.filter((c) => c[0] === 'insert_knowledge_embedding_v2_audited');
    expect(writes).toHaveLength(2);
    expect(writes[0][1]).toMatchObject({ p_chunk_id: 'c1', p_embedding_v2: JSON.stringify([0.1, 0.2, 0.3]), p_model: 'Qwen3-Embedding-4B' });
    await app.close();
  });

  it('counts a failed row without aborting the batch', async () => {
    rpcServiceMock.mockImplementation(spaceRpc(FAKE_BACKEND, (fn) => {
      if (fn === 'fn_get_embeddings_needing_v2') {
        return [
          { embedding_id: 'e1', chunk_id: 'c1', knowledge_item_id: 'k1', chunk_text: 'ok', contextual_prefix: null },
          { embedding_id: 'e2', chunk_id: 'c2', knowledge_item_id: 'k1', chunk_text: 'boom', contextual_prefix: null },
        ];
      }
      return undefined;
    }));
    embedMock
      .mockResolvedValueOnce([[0.1]])
      .mockRejectedValueOnce(new Error('provider 500'));

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/embeddings/v2-backfill', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 2, generated: 1, failed: 1 });
    expect(res.json().failures[0]).toMatchObject({ chunk_id: 'c2' });
    await app.close();
  });
});
