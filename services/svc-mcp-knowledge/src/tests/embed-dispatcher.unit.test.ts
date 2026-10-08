/**
 * Unit tests for embed-dispatcher (RAG Brick 0).
 *
 * Scope: wire protocol + URL/auth resolution. No live embedding calls.
 * Pins: OpenAI-compatible kinds POST {base}/v1/embeddings and parse data[].embedding
 * (index-sorted); ollama POSTs {base}/api/embed and parses {embeddings}; the model is
 * NEVER defaulted (it is a corpus/index constant); a non-2xx throws EmbedDispatchError
 * with the status code. Mirrors llm-completion.unit.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { countTokens, embed, embedSIdentitou, EmbedDispatchError } from '../lib/embed-dispatcher.js';

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('embed-dispatcher — wire protocol', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('OpenAI-compatible kinds POST {base}/v1/embeddings and return index-sorted vectors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        // intentionally out of order — must be sorted by index
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    );

    const out = await embed({ texts: ['a', 'b'], model: 'bge-m3', backendKind: 'vllm', baseUrl: 'http://vllm:8000/v1', trida: 'davka' });

    expect(out).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://vllm:8000/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'bge-m3', input: ['a', 'b'] });
  });

  it("ollama POSTs {base}/api/embed and parses {embeddings}", async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ embeddings: [[0.5, 0.6]] }),
    );

    const out = await embed({ texts: ['x'], model: 'nomic-embed-text', backendKind: 'ollama', baseUrl: 'http://ollama:11434' });

    expect(out).toEqual([[0.5, 0.6]]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://ollama:11434/api/embed');
  });

  it('defaults the OpenAI base for openai/direct_cloud and sends the bearer key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ index: 0, embedding: [1] }] }));

    await embed({ texts: ['t'], model: 'text-embedding-3-small', backendKind: 'openai', apiKey: 'sk-test' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('strips a trailing /v1 (and slashes) before re-appending the protocol suffix', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ index: 0, embedding: [1] }] }));
    await embed({ texts: ['t'], model: 'm', backendKind: 'lmstudio', baseUrl: 'http://lm:1234/v1/' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://lm:1234/v1/embeddings');
  });

  it('NEVER defaults the model — an empty model throws', async () => {
    await expect(embed({ texts: ['t'], model: '', backendKind: 'openai', apiKey: 'k' })).rejects.toBeInstanceOf(EmbedDispatchError);
  });

  it('requires a baseUrl for non-OpenAI kinds (no sane local default)', async () => {
    await expect(embed({ texts: ['t'], model: 'm', backendKind: 'vllm' })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('short-circuits empty input without a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const out = await embed({ texts: [], model: 'm', backendKind: 'openai', apiKey: 'k' });
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws EmbedDispatchError with the provider status on a non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('quota exceeded', { status: 429 }));
    await expect(
      embed({ texts: ['t'], model: 'm', backendKind: 'openai', apiKey: 'k' }),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it('throws on a non-array data payload (shape guard)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ unexpected: true }));
    await expect(
      embed({ texts: ['t'], model: 'm', backendKind: 'openai', apiKey: 'k' }),
    ).rejects.toBeInstanceOf(EmbedDispatchError);
  });

  it('sends MRL `dimensions` to OpenAI-compatible backends but not to Ollama', async () => {
    const openaiMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: [{ index: 0, embedding: [1] }] }));
    await embed({ texts: ['t'], model: 'text-embedding-3-large', backendKind: 'openai', apiKey: 'k', dimensions: 2560 });
    expect(JSON.parse((openaiMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ dimensions: 2560 });

    const ollamaMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ embeddings: [[1]] }));
    await embed({ texts: ['t'], model: 'nomic', backendKind: 'ollama', baseUrl: 'http://o:11434', dimensions: 2560 });
    expect(JSON.parse((ollamaMock.mock.calls[0][1] as RequestInit).body as string)).not.toHaveProperty('dimensions');
  });
});

// ── Lane na GPU (varianta C): třída, typované odmítnutí, identita vah ──────────────────────
const SHA = 'a'.repeat(64);
const LANE = { texts: ['t'], model: 'embed-v1', backendKind: 'local_vllm' as const, baseUrl: 'http://most:8000/v1', apiKey: 'k-lane' };
function odpovedLane(body: unknown, status = 200, hlavicky: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...hlavicky } });
}

describe('embed-dispatcher — lane na GPU (accel-protokol)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('vLLM kind nese x-aisha-trida a klíč; OpenAI třídu nedostane', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => odpovedLane({ data: [{ index: 0, embedding: [1] }] }));
    await embed({ ...LANE, trida: 'dotaz' });
    const h = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h['x-aisha-trida']).toBe('dotaz');
    expect(h.Authorization).toBe('Bearer k-lane');

    await embed({ texts: ['t'], model: 'text-embedding-3-small', backendKind: 'openai', apiKey: 'sk', trida: 'dotaz' });
    const h2 = (fetchMock.mock.calls[1] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h2['x-aisha-trida']).toBeUndefined();
  });

  it('vLLM kind bez třídy → chyba volajícího, žádný požadavek (výchozí se nedosazuje)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(embed({ ...LANE })).rejects.toMatchObject({ statusCode: 500, message: expect.stringMatching(/třída požadavku/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('odmítnutí lane → chyba s KÓDEM ze slovníku a s tím, kdo odmítl', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      odpovedLane({ duvod: 'LANE_NEDOSTUPNA', error: 'uzel neodpovídá' }, 503, { 'x-aisha-odmitl': 'most' }),
    );
    const chyba = await embed({ ...LANE, trida: 'davka' }).catch((e: unknown) => e);
    expect(chyba).toBeInstanceOf(EmbedDispatchError);
    expect(chyba).toMatchObject({ statusCode: 503, duvod: 'LANE_NEDOSTUPNA', odmitl: 'most' });
    expect((chyba as Error).message).toMatch(/LANE_NEDOSTUPNA — uzel neodpovídá \(odmítl: most\)/);
  });

  it('KVOTA_PREKROCENA nese, která kvóta došla, a Retry-After jen jako číslo vteřin', async () => {
    const telo = { duvod: 'KVOTA_PREKROCENA', error: 'okno vyčerpáno', kvota: 'gpu_ms_za_okno' };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(odpovedLane(telo, 429, { 'retry-after': '17' }))
      .mockResolvedValueOnce(odpovedLane(telo, 429, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }))
      .mockResolvedValueOnce(odpovedLane(telo, 429));
    const chyby = [];
    for (let i = 0; i < 3; i++) chyby.push(await embed({ ...LANE, trida: 'davka' }).catch((e: unknown) => e));
    expect(chyby[0]).toMatchObject({ statusCode: 429, duvod: 'KVOTA_PREKROCENA', kvota: 'gpu_ms_za_okno', znovuZaS: 17 });
    expect(chyby[1]).toMatchObject({ duvod: 'KVOTA_PREKROCENA', znovuZaS: null });
    expect(chyby[2]).toMatchObject({ duvod: 'KVOTA_PREKROCENA', znovuZaS: null });
  });

  it.each([
    ['kód mimo slovník', odpovedLane({ duvod: 'NECO_NOVEHO', error: 'x' }, 503)],
    ['tělo není JSON', new Response('Bad Gateway', { status: 502 })],
  ])('%s → chyba BEZ kódu lane (slovník je uzavřený)', async (_p, odpoved) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(odpoved as Response);
    const chyba = await embed({ ...LANE, trida: 'davka' }).catch((e: unknown) => e);
    expect(chyba).toBeInstanceOf(EmbedDispatchError);
    expect((chyba as EmbedDispatchError).duvod).toBeUndefined();
  });

  it('identita vah z hlaviček se vrátí s vektory (E2)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      odpovedLane({ data: [{ index: 0, embedding: [0.5] }] }, 200, {
        'x-aisha-identita': `safetensors:${SHA}`,
        'x-aisha-revize': 'r1',
        'x-aisha-recept': 'mean;l2',
      }),
    );
    const out = await embedSIdentitou({ ...LANE, trida: 'davka' });
    expect(out.vectors).toEqual([[0.5]]);
    expect(out.identita).toEqual({ identita: `safetensors:${SHA}`, revize: 'r1', recept: 'mean;l2' });
  });

  it('backend bez identity (llama.cpp) → identita null, vektory beze změny', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(odpovedLane({ data: [{ index: 0, embedding: [0.5] }] }));
    expect((await embedSIdentitou({ ...LANE, trida: 'davka' })).identita).toBeNull();
  });

  it.each([
    ['vadný tvar identity', { 'x-aisha-identita': 'gguf:nehex', 'x-aisha-recept': 'r' }],
    ['identita bez receptu', { 'x-aisha-identita': `gguf:${SHA}` }],
  ])('%s → 502, vektory se nevrátí (k vektoru nelze uložit neúplnou identitu)', async (_p, hlavicky) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(odpovedLane({ data: [{ index: 0, embedding: [0.5] }] }, 200, hlavicky as Record<string, string>));
    await expect(embedSIdentitou({ ...LANE, trida: 'davka' })).rejects.toMatchObject({ statusCode: 502 });
  });

  it('countTokens nese klíč a třídu; lane bez počítadla odpoví kódem CESTA_NEZNAMA', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      odpovedLane({ duvod: 'CESTA_NEZNAMA', error: 'cesta neexistuje' }, 404, { 'x-aisha-odmitl': 'vstup' }),
    );
    const chyba = await countTokens('http://most:8000/extras/tokenize/count', 'embed-v1', 'text', undefined, {
      apiKey: 'k-lane',
      trida: 'davka',
    }).catch((e: unknown) => e);
    const h = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer k-lane');
    expect(h['x-aisha-trida']).toBe('davka');
    expect(chyba).toMatchObject({ statusCode: 404, duvod: 'CESTA_NEZNAMA' });
  });
});
