/**
 * OpenAI-kompat backend smí na `http://` jen do zón, které instance VLASTNÍ.
 *
 * ⛔ NAMĚŘENO 2026-09-13: `createVLLMBackend()` s adresou, kterou vydává resolver
 * (`http://<prefix>-model.<zóna>:8000/v1`), házel SSRF výjimku dřív, než odešel
 * jediný požadavek. Discovery lokální model nikdy neviděl.
 *
 * Kontrolní vzorky jsou obousměrné: cizí hostitel zůstává odmítnutý, a bez
 * deklarované zóny se nic navíc nepovolí (chybějící hodnota = fail-closed).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  assertSafeUrl,
  createVLLMBackend,
  instanceOwnedZoneSuffixes,
} from "../providers/openai-compat.js";

const ZONA = { INTERNAL_TLD: "testfork.internal", MESH_TLD: "mesh.testfork.internal" } as NodeJS.ProcessEnv;

describe("assertSafeUrl — zóna instance", () => {
  test("http na jméno v INTERNAL_TLD i MESH_TLD projde", () => {
    expect(() => assertSafeUrl("http://testfork-model.experimental.testfork.internal:8000/v1/models", ZONA)).not.toThrow();
    expect(() => assertSafeUrl("http://testfork-model.mesh.testfork.internal:8000/v1/models", ZONA)).not.toThrow();
  });

  test("⛔ cizí hostitel přes http zůstává odmítnutý", () => {
    expect(() => assertSafeUrl("http://evil.example:8000/v1/models", ZONA)).toThrow(/SSRF/);
    // Podřetězec zóny uprostřed jména NENÍ zóna.
    expect(() => assertSafeUrl("http://testfork.internal.evil.example/v1", ZONA)).toThrow(/SSRF/);
  });

  test("⛔ bez deklarované zóny se http mimo localhost nepovolí (fail-closed)", () => {
    expect(() => assertSafeUrl("http://testfork-model.mesh.testfork.internal:8000/v1", {} as NodeJS.ProcessEnv)).toThrow(/SSRF/);
  });

  test("⛔ prázdná zóna nevyrobí příponu '.' (FQDN s koncovou tečkou neprojde)", () => {
    const env = { INTERNAL_TLD: " ", MESH_TLD: "" } as NodeJS.ProcessEnv;
    expect(instanceOwnedZoneSuffixes(env)).toEqual([]);
    expect(() => assertSafeUrl("http://evil.example./v1", env)).toThrow(/SSRF/);
  });

  test("https a localhost se chovají jako dřív", () => {
    expect(() => assertSafeUrl("https://api.example.com/v1", {} as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertSafeUrl("http://127.0.0.1:8000/v1", {} as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("vLLM backend s odvozenou adresou — healthCheck dojde až k síti", () => {
  const puvodni = { ...process.env };
  afterEach(() => {
    process.env = { ...puvodni };
    vi.unstubAllGlobals();
  });

  test("odvozená mesh adresa: fetch se zavolá a listing se přečte", async () => {
    process.env.VLLM_GENERATION_URL = "http://testfork-model.mesh.testfork.internal:8000/v1";
    process.env.VLLM_API_KEY = "k-test-atrapa";
    process.env.MESH_TLD = "mesh.testfork.internal";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "lens" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const backend = createVLLMBackend();
    expect(backend).not.toBeNull();
    const health = await backend!.healthCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("http://testfork-model.mesh.testfork.internal:8000/v1/models");
    expect(health.available).toBe(true);
    expect(health.models).toEqual(["lens"]);
  });
});

describe("vLLM backend: klíč modelu se NEDOSAZUJE (E4)", () => {
  const puvodni = { ...process.env };
  afterEach(() => {
    process.env = { ...puvodni };
    vi.unstubAllGlobals();
  });

  test.each([["chybí", undefined], ["prázdný", "  "]])("adresa modelu a klíč %s → výjimka nahlas, ne literál", (_p, klic) => {
    process.env.VLLM_GENERATION_URL = "http://127.0.0.1:8000/v1";
    if (klic === undefined) delete process.env.VLLM_API_KEY;
    else process.env.VLLM_API_KEY = klic;
    expect(() => createVLLMBackend()).toThrow(/VLLM_API_KEY chybí/);
  });

  test("s klíčem: Authorization nese TEN klíč (ne „vllm“)", async () => {
    process.env.VLLM_GENERATION_URL = "http://127.0.0.1:8000/v1";
    process.env.VLLM_API_KEY = "k-lane-forku";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createVLLMBackend()!.healthCheck();
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k-lane-forku");
  });

  test("bez adresy modelu se backend nezakládá (klíč se nevyžaduje)", () => {
    delete process.env.VLLM_GENERATION_URL;
    delete process.env.VLLM_API_KEY;
    expect(createVLLMBackend()).toBeNull();
  });
});
