/**
 * Integration tests for POST /embeddings/v1-backfill — platformní dopočet vektorů ŽIVÉ identity.
 *
 * ⛔ 2026-09-29 (riq): vektorový index zamrzl k 30. 8.; staré vektory nesly jméno živého modelu,
 * ale jiný runtime (sentence-transformers) nebo jiné jméno (MLX). Majitel: přepočítat „samo na
 * serveru". Test drží řetěz: fn_get_chunks_needing_v1 → tokenize/count (svc-model) → nad
 * limitem fn_record_embedding_vynechani / jinak embed → insert_knowledge_embedding s identitou
 * a receptem ve model_version. Regrese (tichý ořez, chybějící recept, dávka bez ústupu)
 * by index tiše poškodila.
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

vi.mock('../lib/capability-resolver.js', () => ({ resolveRagBackend: vi.fn() }));

const embedMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/embed-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/embed-dispatcher.js')>();
  return { ...actual, embed: embedMock };
});
vi.mock('../lib/rule-embedding-text.js', () => ({ composeRuleEmbeddingText: vi.fn() }));
vi.mock('../lib/contextual-prefix.js', () => ({ generateContextualPrefix: vi.fn() }));
vi.mock('../lib/ingestion-safety.js', () => ({ scanForInjection: vi.fn(() => ({ safe: true })) }));

const BACKEND = {
  provider_slug: 'vllm-local',
  model_id: 'bge-m3-embedding',
  backend_kind: 'local_vllm' as const,
  endpoint_url: 'http://svc-model:8000/v1',
  auth_env_var: null,
  embedding_dimensions: null,
  rag_space: 'v1',
};
const IDENTITA = 'gguf:' + 'a'.repeat(64);
const radek = (id: string, text = 'faktura za nájem') => ({
  chunk_id: id, knowledge_item_id: 'k1', chunk_text: text, contextual_prefix: null,
  locale: 'cs', model_id: 'bge-m3-embedding', identita: IDENTITA, max_tokens: 512,
});

/** RPC mock: resolver v1 → BACKEND; dávka → `rows`; ostatní zaznamená. */
function rpc(rows: unknown, zapis: Array<[string, Record<string, unknown>]>) {
  return async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'fn_resolve_embedding_model_for_space') {
      expect(args.p_rag_space).toBe('v1');
      return [BACKEND];
    }
    if (fn === 'fn_get_chunks_needing_v1') {
      if (rows instanceof Error) throw rows;
      return rows;
    }
    zapis.push([fn, args]);
    return null;
  };
}

/** fetch mock pro /extras/tokenize/count — počet tokenů podle textu. */
function tokenizer(pocet: (text: string) => number | Error) {
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    expect(url).toBe('http://svc-model:8000/extras/tokenize/count');
    const n = pocet(JSON.parse(init.body).input);
    if (n instanceof Error) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ count: n }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function buildApp() {
  const app = Fastify!();
  const { knowledgeEmbeddingsRoutes } = await import('../routes/knowledge-embeddings.js');
  await app.register(knowledgeEmbeddingsRoutes);
  await app.ready();
  return app;
}

describeIfFastify('POST /embeddings/v1-backfill', () => {
  beforeEach(() => {
    verifyServiceRoleMock.mockReset().mockReturnValue(undefined);
    rpcServiceMock.mockReset();
    embedMock.mockReset().mockImplementation(async ({ texts }: { texts: string[] }) => texts.map(() => [0.1, 0.2]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('zakóduje chunk a zapíše identitu + recept do model_version (přepis na místě)', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1'), radek('c2')], zapis));
    tokenizer(() => 18);
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: { batch_size: '50' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ generated: 2, nad_limitem: 0, failed: 0, konec: 'hotovo', recept: 'chunk_text_v1' });
    const vlozeno = zapis.filter(([fn]) => fn === 'insert_knowledge_embedding').map(([, a]) => a);
    expect(vlozeno).toHaveLength(2);
    expect(vlozeno[0]).toMatchObject({ p_chunk_id: 'c1', p_model: 'bge-m3-embedding', p_locale: 'cs',
      p_model_version: `${IDENTITA};recipe=chunk_text_v1` });
  });

  it('text nad max_tokens NEKÓDUJE (tichý ořez) a zapíše ho mezi vynechané', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1', 'dlouhý'), radek('c2')], zapis));
    tokenizer((t) => (t === 'dlouhý' ? 600 : 18));
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 1, nad_limitem: 1 });
    expect(zapis).toContainEqual(['fn_record_embedding_vynechani',
      { p_chunk_id: 'c1', p_locale: 'cs', p_identita: IDENTITA, p_duvod: 'nad_limitem', p_tokenu: 600 }]);
    expect(embedMock).toHaveBeenCalledTimes(1);
  });

  it('bez tokenizace se nekóduje nic (nelze vyloučit ořez)', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1')], zapis));
    tokenizer(() => new Error('down'));
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 0, konec: 'tokenizace_nedostupna' });
    expect(embedMock).not.toHaveBeenCalled();
    expect(zapis).toHaveLength(0);
  });

  it('neznámá živá identita (chybí declared pin) = 502 nahlas, ne prázdná dávka', async () => {
    rpcServiceMock.mockImplementation(rpc(new Error('živá identita embeddingu bge-m3-embedding neznámá'), []));
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toContain('živá identita');
  });

  it('USTOUPÍ, když latence na token vyskočí (souběh s dotazy uživatelů)', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((c) => radek(c)), zapis));
    tokenizer(() => 1);
    let volani = 0;
    embedMock.mockImplementation(async ({ texts }: { texts: string[] }) => {
      volani += 1;
      if (volani === 5) await new Promise((r) => setTimeout(r, 250));
      return texts.map(() => [0.1]);
    });
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ konec: 'ustoupeno', generated: 5 });
    expect(embedMock).toHaveBeenCalledTimes(5);
  });

  it('401 bez service role; 503 bez backendu', async () => {
    verifyServiceRoleMock.mockImplementation(() => { throw new Error('no'); });
    const app = await buildApp();
    expect((await app.inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} })).statusCode).toBe(401);
    verifyServiceRoleMock.mockReset().mockReturnValue(undefined);
    rpcServiceMock.mockImplementation(async (fn: string) => (fn === 'fn_resolve_embedding_model_for_space' ? [] : null));
    expect((await app.inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} })).statusCode).toBe(503);
  });
});
