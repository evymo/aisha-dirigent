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
import { embed, EmbedDispatchError } from '../lib/embed-dispatcher.js';

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

    const out = await embed({ texts: ['a', 'b'], model: 'bge-m3', backendKind: 'vllm', baseUrl: 'http://vllm:8000/v1' });

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
