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
const identitaMock = vi.hoisted(() => ({ hodnota: null as null | { identita: string; revize: string | null; recept: string } }));
vi.mock('../lib/embed-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/embed-dispatcher.js')>();
  return {
    ...actual,
    embed: embedMock,
    // Cesty volají embedSIdentitou (identita vah k vektoru); vektory dál dodává embedMock.
    embedSIdentitou: async (o: Parameters<typeof actual.embedSIdentitou>[0]) => ({
      vectors: (await embedMock(o)) as number[][],
      identita: identitaMock.hodnota,
    }),
  };
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

/**
 * RPC mock: resolver v1 → BACKEND; fronta → `rows` JAKO DB (fn_get_chunks_needing_v1 vrací jen
 * chunky BEZ vektoru živé identity: zapsané ani vynechané se nevrací, nejvýš p_batch_size);
 * ostatní zaznamená. Smyčka dávek (P2) se tak měří proti skutečné idempotenci fronty.
 */
function rpc(rows: unknown, zapis: Array<[string, Record<string, unknown>]>) {
  return async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'fn_resolve_embedding_model_for_space') {
      expect(args.p_rag_space).toBe('v1');
      return [BACKEND];
    }
    if (fn === 'fn_get_chunks_needing_v1') {
      if (rows instanceof Error) throw rows;
      const hotove = new Set(
        zapis.filter(([f]) => f === 'insert_knowledge_embedding' || f === 'fn_record_embedding_vynechani').map(([, a]) => a.p_chunk_id),
      );
      return (rows as Array<{ chunk_id: string }>).filter((r) => !hotove.has(r.chunk_id)).slice(0, Number(args.p_batch_size));
    }
    zapis.push([fn, args]);
    return null;
  };
}

/** fetch mock pro /extras/tokenize/count — počet tokenů podle textu (skutečné Response). */
function tokenizer(pocet: (text: string) => number | Error | Response) {
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    expect(url).toBe('http://svc-model:8000/extras/tokenize/count');
    const n = pocet(JSON.parse(init.body).input);
    if (n instanceof Response) return n;
    if (n instanceof Error) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ count: n }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    identitaMock.hodnota = null;
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

// ── Lane na GPU (varianta C): počítadlo nemá, nad oknem odmítne kódem, identita vah se ověřuje ──
const odmitnutiLane = (duvod: string, status: number) =>
  new Response(JSON.stringify({ duvod, error: 'lane' }), { status, headers: { 'Content-Type': 'application/json' } });

describeIfFastify('POST /embeddings/v1-backfill — lane na GPU', () => {
  beforeEach(() => {
    verifyServiceRoleMock.mockReset().mockReturnValue(undefined);
    rpcServiceMock.mockReset();
    embedMock.mockReset().mockImplementation(async ({ texts }: { texts: string[] }) => texts.map(() => [0.1, 0.2]));
    identitaMock.hodnota = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('počítadlo odpoví CESTA_NEZNAMA → kóduje se bez předpočtu (lane neořezává), počítadlo se už nevolá', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1'), radek('c2')], zapis));
    const pocitadlo = tokenizer(() => odmitnutiLane('CESTA_NEZNAMA', 404));
    identitaMock.hodnota = { identita: IDENTITA, revize: null, recept: 'mean' };
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 2, nad_limitem: 0, failed: 0, konec: 'hotovo' });
    expect(pocitadlo).toHaveBeenCalledTimes(1);
    expect(embedMock).toHaveBeenCalledTimes(2);
    const h = (pocitadlo.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
    expect(h['x-aisha-trida']).toBe('davka');
  });

  it('lane odmítne vstup nad oknem (ENGINE_ODMITL) → vynechaný „nad_limitem“ bez počtu, dávka pokračuje', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1', 'dlouhý'), radek('c2')], zapis));
    tokenizer(() => odmitnutiLane('CESTA_NEZNAMA', 404));
    const { EmbedDispatchError } = await import('../lib/embed-dispatcher.js');
    embedMock.mockImplementation(async ({ texts }: { texts: string[] }) => {
      if (texts[0] === 'dlouhý') throw new EmbedDispatchError(400, 'nad oknem', undefined, 'ENGINE_ODMITL');
      return texts.map(() => [0.1, 0.2]);
    });
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 1, nad_limitem: 1, failed: 0 });
    expect(zapis).toContainEqual(['fn_record_embedding_vynechani',
      { p_chunk_id: 'c1', p_locale: 'cs', p_identita: IDENTITA, p_duvod: 'nad_limitem', p_tokenu: null }]);
  });

  it('⭐ kvóta nájemce došla (KVOTA_PREKROCENA) → dávka KONČÍ, zbytek se nepropálí a nic se nepočítá jako selhání', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1'), radek('c2', 'druhý'), radek('c3')], zapis));
    tokenizer(() => odmitnutiLane('CESTA_NEZNAMA', 404));
    const { EmbedDispatchError } = await import('../lib/embed-dispatcher.js');
    embedMock.mockImplementation(async ({ texts }: { texts: string[] }) => {
      if (texts[0] === 'druhý') {
        throw new EmbedDispatchError(429, 'lane odmítla embed: KVOTA_PREKROCENA', undefined, 'KVOTA_PREKROCENA', 'vstup', 'gpu_ms_za_okno', 17);
      }
      return texts.map(() => [0.1, 0.2]);
    });
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ generated: 1, failed: 0, nad_limitem: 0, konec: 'kvota',
      kvota: { druh: 'gpu_ms_za_okno', retry_after_s: 17 } });
    expect(embedMock).toHaveBeenCalledTimes(2);
    expect(zapis.filter(([fn]) => fn === 'insert_knowledge_embedding').map(([, a]) => a.p_chunk_id)).toEqual(['c1']);
    expect(zapis.filter(([fn]) => fn === 'fn_record_embedding_vynechani')).toHaveLength(0);
  });

  it('kvóta došla už u počítadla tokenů → dávka končí týmž kódem, ne „tokenizace nedostupná“', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1'), radek('c2')], zapis));
    tokenizer(() => new Response(JSON.stringify({ duvod: 'KVOTA_PREKROCENA', error: 'okno vyčerpáno', kvota: 'gpu_ms_za_okno' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }));
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 0, failed: 0, konec: 'kvota', kvota: { druh: 'gpu_ms_za_okno', retry_after_s: null } });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('vektor spočítaly JINÉ váhy, než instance deklaruje → neuložit nic a zastavit (F5/R5c)', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1'), radek('c2')], zapis));
    tokenizer(() => odmitnutiLane('CESTA_NEZNAMA', 404));
    identitaMock.hodnota = { identita: 'safetensors:' + 'c'.repeat(64), revize: null, recept: 'mean' };
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 0, failed: 1, konec: 'identita_nesouhlasi' });
    expect(zapis.filter(([fn]) => fn === 'insert_knowledge_embedding')).toHaveLength(0);
    expect(embedMock).toHaveBeenCalledTimes(1);
  });

  it('lane stojí (LANE_NEDOSTUPNA) → řádek selže nahlas, nic se nezapíše a nic jiného se nezavolá', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc([radek('c1')], zapis));
    tokenizer(() => odmitnutiLane('CESTA_NEZNAMA', 404));
    const { EmbedDispatchError } = await import('../lib/embed-dispatcher.js');
    embedMock.mockRejectedValue(new EmbedDispatchError(503, 'lane odmítla embed: LANE_NEDOSTUPNA', undefined, 'LANE_NEDOSTUPNA', 'most'));
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 0, failed: 1 });
    expect(res.json().failures[0].reason).toMatch(/LANE_NEDOSTUPNA/);
    expect(zapis.filter(([fn]) => fn === 'insert_knowledge_embedding')).toHaveLength(0);
  });
});

// ── P2 (2026-10-06): dávky ve smyčce do vyschnutí fronty / časového rozpočtu ──────────────────
describeIfFastify('POST /embeddings/v1-backfill — smyčka dávek (P2)', () => {
  beforeEach(() => {
    verifyServiceRoleMock.mockReset().mockReturnValue(undefined);
    rpcServiceMock.mockReset();
    embedMock.mockReset().mockImplementation(async ({ texts }: { texts: string[] }) => texts.map(() => [0.1, 0.2]));
    identitaMock.hodnota = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const fronta = (n: number) => Array.from({ length: n }, (_, i) => radek(`c${i + 1}`));
  const vyberu = () => rpcServiceMock.mock.calls.filter(([fn]) => fn === 'fn_get_chunks_needing_v1').length;

  it('⭐ jedno volání bere dávky, dokud fronta nevyschne (5 chunků po 2 = 3 dávky, hotovo)', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc(fronta(5), zapis));
    tokenizer(() => 18);
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: { batch_size: '2' } });
    expect(res.json()).toMatchObject({ generated: 5, failed: 0, davek: 3, konec: 'hotovo', identita: IDENTITA });
    expect(vyberu(), '3 dávky + jeden výběr, který zjistí prázdnou frontu').toBe(4);
    expect(zapis.filter(([fn]) => fn === 'insert_knowledge_embedding').map(([, a]) => a.p_chunk_id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('kvóta nájemce ve DRUHÉ dávce smyčku zastaví (kontrakt KVOTA_PREKROCENA platí i mezi dávkami)', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc(fronta(4), zapis));
    tokenizer(() => 18);
    const { EmbedDispatchError } = await import('../lib/embed-dispatcher.js');
    let volani = 0;
    embedMock.mockImplementation(async ({ texts }: { texts: string[] }) => {
      volani += 1;
      if (volani === 3) throw new EmbedDispatchError(429, 'lane odmítla embed: KVOTA_PREKROCENA', undefined, 'KVOTA_PREKROCENA', 'vstup', 'gpu_ms_za_okno', 30);
      return texts.map(() => [0.1, 0.2]);
    });
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: { batch_size: '2' } });
    expect(res.json()).toMatchObject({ generated: 2, failed: 0, davek: 2, konec: 'kvota', kvota: { druh: 'gpu_ms_za_okno', retry_after_s: 30 } });
    expect(vyberu(), 'po kvótě se další dávka nebere').toBe(2);
  });

  it('dávka bez postupu (jen selhání) smyčku zastaví — volání se netočí nad týmiž vadnými řádky', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    const zaklad = rpc(fronta(3), zapis);
    rpcServiceMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'insert_knowledge_embedding') throw new Error('DB odmítla zápis');
      return zaklad(fn, args);
    });
    tokenizer(() => 18);
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: { max_ms: '3000' } });
    expect(res.json()).toMatchObject({ generated: 0, failed: 3, davek: 1, konec: 'bez_postupu' });
    expect(vyberu()).toBe(1);
    expect(embedMock).toHaveBeenCalledTimes(3);
  });

  it('chunk, který volání už zkusilo, se v něm podruhé nezkouší (idempotence uvnitř volání)', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    const zaklad = rpc(fronta(3), zapis);
    // c1 selže, c2 a c3 projdou; fronta pak vrací c1 znovu (nemá vektor) → nové nic → stop.
    rpcServiceMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'insert_knowledge_embedding' && args.p_chunk_id === 'c1') throw new Error('vadný chunk');
      return zaklad(fn, args);
    });
    tokenizer(() => 18);
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: { batch_size: '2' } });
    expect(res.json()).toMatchObject({ generated: 2, failed: 1, konec: 'bez_postupu' });
    expect(embedMock).toHaveBeenCalledTimes(3);
  });

  it('identita se mezi dávkami změní (nová deklarace) → stop, pod starou identitou se nic dalšího nepíše', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    const jina = 'pytorch:' + 'b'.repeat(64);
    let vyber = 0;
    rpcServiceMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'fn_get_chunks_needing_v1') {
        vyber += 1;
        return vyber === 1 ? [radek('c1')] : [{ ...radek('c2'), identita: jina }];
      }
      return rpc([], zapis)(fn, args);
    });
    tokenizer(() => 18);
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.json()).toMatchObject({ generated: 1, konec: 'identita_zmenena', identita: IDENTITA });
    expect(zapis.filter(([fn]) => fn === 'insert_knowledge_embedding').map(([, a]) => a.p_chunk_id)).toEqual(['c1']);
  });

  it('další dávka se nenačte → stop nahlas (vyber_selhal), hotové zůstane zapsané', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    let vyber = 0;
    rpcServiceMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'fn_get_chunks_needing_v1') {
        vyber += 1;
        if (vyber === 2) throw new Error('PostgREST 503');
        return [radek('c1')];
      }
      return rpc([], zapis)(fn, args);
    });
    tokenizer(() => 18);
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ generated: 1, davek: 1, konec: 'vyber_selhal' });
  });

  it('časový rozpočet (max_ms) ukončí smyčku mezi dávkami i uvnitř dávky', async () => {
    const zapis: Array<[string, Record<string, unknown>]> = [];
    rpcServiceMock.mockImplementation(rpc(fronta(50), zapis));
    tokenizer(() => 18);
    embedMock.mockImplementation(async ({ texts }: { texts: string[] }) => {
      await new Promise((r) => setTimeout(r, 120));
      return texts.map(() => [0.1, 0.2]);
    });
    const res = await (await buildApp()).inject({ method: 'POST', url: '/embeddings/v1-backfill', payload: { batch_size: '3', max_ms: '1000' } });
    const telo = res.json();
    expect(telo.konec).toBe('casovy_limit');
    expect(telo.generated).toBeGreaterThan(3);
    expect(telo.generated).toBeLessThan(50);
  });
});
