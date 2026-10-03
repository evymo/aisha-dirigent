/**
 * Úplnost listingu modelů + měřený rozměr embeddingu.
 *
 * ⛔ „Tool failure ≠ data": discovery smí vést model jako nedostupný JEN tehdy,
 * když backend výslovně řekne, že jeho seznam je ÚPLNÝ. Stránkovaný listing
 * (Anthropic `has_more`, Gemini `nextPageToken`) nebo nečitelné tělo úplné není
 * — jinak by první stránka tiše „vyřadila" všechno za ní.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { OpenAICompatBackend } from "../providers/openai-compat.js";
import { AnthropicBackend } from "../providers/anthropic.js";
import { GeminiBackend } from "../providers/gemini.js";
import { OpenAIBackend } from "../providers/openai.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const lokalni = () =>
  new OpenAICompatBackend({
    id: "vllm",
    label: "test",
    baseUrl: "http://127.0.0.1:8000/v1",
    kind: "local",
    supportsTools: false,
    modelPrefixes: [],
  });

afterEach(() => vi.unstubAllGlobals());

describe("HealthResult.modelsComplete", () => {
  test("OpenAI-kompat /v1/models (nestránkuje) → úplný výčet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "lens" }, { id: "lens-embedding" }] })));
    const h = await lokalni().healthCheck();
    expect(h).toMatchObject({ available: true, models: ["lens", "lens-embedding"], modelsComplete: true });
  });

  test("prázdné, ale PŘEČTENÉ pole je úplný výčet (nic se neobsluhuje)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [] })));
    const h = await lokalni().healthCheck();
    expect(h.modelsComplete).toBe(true);
    expect(h.models).toBeUndefined();
  });

  test("⛔ nečitelné tělo NENÍ úplný výčet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ unexpected: true })));
    const h = await lokalni().healthCheck();
    expect(h.available).toBe(true);
    expect(h.modelsComplete).toBeUndefined();
  });

  test("OpenAI direct: přečtené data[] → úplné", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "gpt-x" }] })));
    const h = await new OpenAIBackend("k").healthCheck();
    expect(h.modelsComplete).toBe(true);
  });

  test("⛔ Anthropic has_more:true → NEÚPLNÉ; has_more:false → úplné", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "claude-a" }], has_more: true })));
    expect((await new AnthropicBackend("k").healthCheck()).modelsComplete).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "claude-a" }], has_more: false })));
    expect((await new AnthropicBackend("k").healthCheck()).modelsComplete).toBe(true);
  });

  test("⛔ Gemini s nextPageToken → NEÚPLNÉ; bez → úplné", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ models: [{ name: "models/gemini-a" }], nextPageToken: "p2" })));
    expect((await new GeminiBackend("k").healthCheck()).modelsComplete).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => json({ models: [{ name: "models/gemini-a" }] })));
    expect((await new GeminiBackend("k").healthCheck()).modelsComplete).toBe(true);
  });
});

describe("OpenAICompatBackend.embeddingDimension — rozměr se měří", () => {
  test("vrací délku vektoru a posílá PŘESNĚ měřený model", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return json({ data: [{ index: 0, embedding: new Array(1024).fill(0.1) }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(lokalni().embeddingDimension("lens-embedding")).resolves.toBe(1024);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/v1/embeddings");
    expect(JSON.parse(String(init.body)).model).toBe("lens-embedding");
  });

  test("⛔ chyba providera je výjimka, ne rozměr", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("model not found", { status: 404 })));
    await expect(lokalni().embeddingDimension("nope")).rejects.toThrow(/404/);
  });

  test("⛔ nečíselná odpověď je výjimka, ne rozměr", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ embedding: [] }] })));
    await expect(lokalni().embeddingDimension("lens-embedding")).rejects.toThrow(/nevrátil číselný vektor/);
  });
});
