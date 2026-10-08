/**
 * POST /embeddings/rules a /embeddings/memories — zápis do prostoru v1 přes resolver prostoru.
 *
 * ⛔ NAMĚŘENO 2026-09-13: obě dráhy volaly `generateEmbeddings()` s `backendKind: 'openai'`
 * a modelem `EMBEDDING_MODEL ?? 'text-embedding-3-small'` (1536) do sloupců vector(1024)
 * (expert_rules.content_embedding, agent_memories.embedding). Zápis tedy nemohl projít
 * nikdy a cold-start krok 6b na dráze pravidel stál.
 *
 * Drží se:
 *   1. model se žádá pro prostor v1 (fn_resolve_embedding_model_for_space), ne pro OpenAI,
 *   2. žádný model pro prostor = 503 a nic se neembeduje (fail-closed, žádný cloud fallback),
 *   3. vektor jiné délky, než registr vede, je chyba DANÉHO pravidla — nic se nezapíše.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const verifyServiceRoleMock = vi.hoisted(() => vi.fn());
vi.mock('../auth.js', () => ({ verifyServiceRole: verifyServiceRoleMock, AuthError: class extends Error {} }));

const rpcServiceMock = vi.hoisted(() => vi.fn());
vi.mock('../postgrest.js', () => ({ rpcService: rpcServiceMock }));

const embedMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/embed-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/embed-dispatcher.js')>();
  return {
    ...actual,
    embed: embedMock,
    // Cesty volají embedSIdentitou (identita vah k vektoru); vektory dál dodává embedMock.
    embedSIdentitou: async (o: Parameters<typeof actual.embedSIdentitou>[0]) => ({
      vectors: (await embedMock(o)) as number[][],
      identita: null,
    }),
  };
});

const V1_BACKEND = {
  model_id: 'lens-embedding',
  provider_slug: 'vllm-local',
  backend_kind: 'local_vllm',
  endpoint_url: 'http://testfork-model.mesh.testfork.internal:8000/v1',
  auth_env_var: null,
  embedding_dimensions: 1024,
  rag_space: 'v1',
};

const RULE = {
  id: 'r1',
  slug: 'rule-one',
  title: 'Pravidlo',
  summary: 'Shrnutí',
  body_markdown: 'Tělo',
  ai_instructions: null,
  ai_context_tags: null,
};

function rpc(backendRow: typeof V1_BACKEND | null) {
  return async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'fn_resolve_embedding_model_for_space') {
      expect(args.p_rag_space, 'sloupce pravidel a pamětí jsou prostor v1').toBe('v1');
      return backendRow ? [backendRow] : [];
    }
    if (fn === 'get_rules_for_embedding') return [RULE];
    if (fn === 'fn_get_memories_without_embeddings') {
      return [{ id: 'm1', content: 'vzpomínka', agent_slug: 'a', memory_type: 'learning' }];
    }
    return undefined;
  };
}

async function buildApp() {
  const app = Fastify();
  const { embeddingsRoutes } = await import('../routes/embeddings.js');
  await app.register(embeddingsRoutes);
  await app.ready();
  return app;
}

describe('embeddings rules/memories → prostor v1', () => {
  beforeEach(() => {
    verifyServiceRoleMock.mockReset().mockReturnValue(undefined);
    rpcServiceMock.mockReset();
    embedMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('pravidla: embeduje model prostoru v1 z registru a zapisuje jeho vektor', async () => {
    rpcServiceMock.mockImplementation(rpc(V1_BACKEND));
    embedMock.mockResolvedValue([new Array(1024).fill(0.5)]);

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/embeddings/rules', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ processed: 1, succeeded: 1, failed: 0, model: 'lens-embedding' });

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock.mock.calls[0][0]).toMatchObject({
      model: 'lens-embedding',
      backendKind: 'local_vllm',
      baseUrl: 'http://testfork-model.mesh.testfork.internal:8000/v1',
    });
    expect(embedMock.mock.calls[0][0].backendKind, 'žádný natvrdo OpenAI').not.toBe('openai');
    const zapis = rpcServiceMock.mock.calls.find((c) => c[0] === 'update_rule_embedding');
    expect(zapis?.[1]).toMatchObject({ p_id: 'r1' });
    await app.close();
  });

  it('⛔ pravidla: bez modelu prostoru v1 → 503, nic se neembeduje ani nezapíše', async () => {
    rpcServiceMock.mockImplementation(rpc(null));
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/embeddings/rules', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(embedMock).not.toHaveBeenCalled();
    expect(rpcServiceMock.mock.calls.some((c) => c[0] === 'update_rule_embedding')).toBe(false);
    await app.close();
  });

  it('⛔ pravidla: vektor délky 1536 do prostoru 1024 je chyba pravidla, ne zápis', async () => {
    rpcServiceMock.mockImplementation(rpc(V1_BACKEND));
    embedMock.mockResolvedValue([new Array(1536).fill(0.5)]);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/embeddings/rules', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ succeeded: 0, failed: 1 });
    expect(res.json().results[0].error).toMatch(/délky 1536.*registr vede 1024/);
    expect(rpcServiceMock.mock.calls.some((c) => c[0] === 'update_rule_embedding')).toBe(false);
    await app.close();
  });

  it('paměti: týž resolver prostoru v1; bez modelu 503', async () => {
    rpcServiceMock.mockImplementation(rpc(V1_BACKEND));
    embedMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    const app = await buildApp();
    const ok = await app.inject({ method: 'POST', url: '/embeddings/memories', payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ processed: 1, success: 1, errors: 0 });

    rpcServiceMock.mockImplementation(rpc(null));
    embedMock.mockReset();
    const none = await app.inject({ method: 'POST', url: '/embeddings/memories', payload: {} });
    expect(none.statusCode).toBe(503);
    expect(embedMock).not.toHaveBeenCalled();
    await app.close();
  });
});
