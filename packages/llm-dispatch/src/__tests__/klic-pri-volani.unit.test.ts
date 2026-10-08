/**
 * Klíč poskytovatele se bere V OKAMŽIKU VOLÁNÍ přes čtečku pověření služby — ne
 * z process.env při sestavení backendu (fáze 1b, 2026-10-02).
 *
 * Měří se se SKUTEČNOU čtečkou `@aisha/security` createCredentialReader (falešné je
 * jen RPC trezoru), tak jak ji svc-ai-chat předá přes setProviderKeySource:
 *   klíč jen v trezoru  → volání ho použije (i když env má jiný),
 *   klíč jen v env      → přechodně env + JEDNO hlasité varování „nastavte v administraci",
 *   nic                 → hlasitá chyba, nic neodejde,
 *   trezor nedostupný   → chyba, žádný tichý env.
 * Registr: klíč jen v trezoru backend PŘIDÁ, klíč nikde ho ODEBERE.
 * Kontrolní vzorek: bez zdroje se chová jako dřív (env).
 * Hodnoty jsou sentinely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCredentialReader } from "@aisha/security";
import { AnthropicBackend } from "../providers/anthropic.js";
import { GeminiBackend } from "../providers/gemini.js";
import { xaiBackend } from "../providers/openai-compat.js";
import { BackendRegistry } from "../backendRegistry.js";
import { setProviderKeySource } from "../credentialSource.js";

const ENV = ["ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "AISHA_EXECUTION_MODE"];
const puvodni: Record<string, string | undefined> = {};
const KATALOG = new Set(["ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"]);

let trezor: Map<string, string>;
let trezorDole: boolean;
let varovani: string[];
let volani: Array<{ url: string; headers: Record<string, string> }>;
const realFetch = globalThis.fetch;

function zapojCtecku(): void {
  const reader = createCredentialReader({
    service: "test-llm-dispatch",
    rpc: async (fn, params) => {
      if (trezorDole) throw new Error("RPC get_provider_credentials failed (503)");
      if (fn !== "get_provider_credentials") throw new Error(`neočekávané RPC ${fn}`);
      return (params.p_env_vars as string[]).filter((j) => KATALOG.has(j)).map((j) => ({ env_var: j, value: trezor.get(j) ?? null }));
    },
    logger: {
      safeInfo: () => undefined,
      safeWarn: (msg) => varovani.push(msg),
      safeError: () => undefined,
    },
  });
  setProviderKeySource((v) => reader.get(v));
}

beforeEach(() => {
  for (const k of ENV) {
    puvodni[k] = process.env[k];
    delete process.env[k];
  }
  trezor = new Map();
  trezorDole = false;
  varovani = [];
  volani = [];
  globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    volani.push({ url: String(url), headers: init?.headers ?? {} });
    if (String(url).includes("anthropic")) {
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 },
      );
    }
    if (String(url).includes("generativelanguage")) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: "grok-x" }),
      { status: 200 },
    );
  }) as typeof fetch;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setProviderKeySource(null);
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (puvodni[k] === undefined) delete process.env[k];
    else process.env[k] = puvodni[k];
  }
  vi.restoreAllMocks();
});

const ZPRAVA = { model: "claude-x", messages: [{ role: "user" as const, content: "q" }] };

describe("klíč poskytovatele při volání přes čtečku pověření", () => {
  it("klíč jen v trezoru → volání ho použije, i když env nese jiný; žádné varování", async () => {
    zapojCtecku();
    trezor.set("ANTHROPIC_API_KEY", "SENTINEL-trezor-anthropic");
    process.env.ANTHROPIC_API_KEY = "SENTINEL-env-anthropic";
    await new AnthropicBackend().chat(ZPRAVA);
    expect(volani[0]!.headers["x-api-key"]).toBe("SENTINEL-trezor-anthropic");
    expect(varovani).toEqual([]);
  });

  it("klíč jen v env → přechodně env + JEDNO hlasité varování „nastavte v administraci“", async () => {
    zapojCtecku();
    process.env.ANTHROPIC_API_KEY = "SENTINEL-env-anthropic";
    const b = new AnthropicBackend();
    await b.chat(ZPRAVA);
    await b.chat(ZPRAVA);
    expect(volani.map((v) => v.headers["x-api-key"])).toEqual(["SENTINEL-env-anthropic", "SENTINEL-env-anthropic"]);
    expect(varovani).toHaveLength(1);
    expect(varovani[0]).toMatch(/ANTHROPIC_API_KEY bere z prostředí — nastavte ho v administraci/);
    expect(varovani.join("\n")).not.toContain("SENTINEL");
  });

  it("nic → hlasitá chyba, požadavek neodejde", async () => {
    zapojCtecku();
    await expect(new AnthropicBackend().chat(ZPRAVA)).rejects.toThrow(/ANTHROPIC_API_KEY not configured — pověření nastavte v administraci/);
    expect(volani).toEqual([]);
    expect(await new AnthropicBackend().healthCheck()).toEqual({ available: false });
  });

  it("trezor nedostupný → chyba, žádný tichý env", async () => {
    zapojCtecku();
    trezorDole = true;
    process.env.ANTHROPIC_API_KEY = "SENTINEL-env-anthropic";
    await expect(new AnthropicBackend().chat(ZPRAVA)).rejects.toThrow(/Trezor pověření nedostupný/);
    expect(volani).toEqual([]);
  });

  it("Gemini i xAI berou klíč z trezoru při volání", async () => {
    zapojCtecku();
    trezor.set("GOOGLE_AI_API_KEY", "SENTINEL-trezor-google");
    trezor.set("XAI_API_KEY", "SENTINEL-trezor-xai");
    await new GeminiBackend().chat({ model: "gemini-x", messages: [{ role: "user", content: "q" }] });
    await xaiBackend().chat({ model: "grok-x", messages: [{ role: "user", content: "q" }] });
    expect(volani.find((v) => v.url.includes(":generateContent"))!.url).toContain("key=SENTINEL-trezor-google");
    expect(volani.find((v) => v.url.endsWith("/chat/completions"))!.headers["Authorization"]).toBe("Bearer SENTINEL-trezor-xai");
  });

  it("pevný klíč od volajícího (resolver mcp-knowledge) má přednost a čtečka se neptá", async () => {
    zapojCtecku();
    trezorDole = true; // kdyby se čtečka ptala, volání by spadlo
    await new AnthropicBackend("SENTINEL-pevny").chat(ZPRAVA);
    expect(volani[0]!.headers["x-api-key"]).toBe("SENTINEL-pevny");
  });

  it("KONTROLNÍ VZOREK: bez zdroje pověření se backend chová jako dřív (process.env)", async () => {
    process.env.ANTHROPIC_API_KEY = "SENTINEL-env-bez-zdroje";
    await new AnthropicBackend().chat(ZPRAVA);
    expect(volani[0]!.headers["x-api-key"]).toBe("SENTINEL-env-bez-zdroje");
  });
});

describe("registr: obsluhovatelnost podle pověření instance", () => {
  const idcka = (r: BackendRegistry) => r.getAllBackends().map((b) => b.id).sort();

  it("klíč jen v trezoru backend PŘIDÁ; smazaný klíč (nikde) ho ODEBERE", async () => {
    zapojCtecku();
    const r = new BackendRegistry();
    expect(idcka(r)).not.toContain("anthropic"); // env nic nemá
    trezor.set("ANTHROPIC_API_KEY", "SENTINEL-trezor-anthropic");
    expect((await r.reconcileCredentialBackends()).added).toEqual(["anthropic"]);
    expect(idcka(r)).toContain("anthropic");
    // Smazání v administraci (čtečka má mezipaměť ~60 s — nová čtečka = po jejím vypršení).
    trezor.delete("ANTHROPIC_API_KEY");
    zapojCtecku();
    expect((await r.reconcileCredentialBackends()).removed).toEqual(["anthropic"]);
    expect(idcka(r)).not.toContain("anthropic");
  });

  it("bez zdroje pověření registr nic nemění (zůstává podle env)", async () => {
    process.env.ANTHROPIC_API_KEY = "SENTINEL-env";
    const r = new BackendRegistry();
    expect(await r.reconcileCredentialBackends()).toEqual({ added: [], removed: [] });
    expect(idcka(r)).toContain("anthropic");
  });

  it("rezidence platí i tady: v režimu local se cloudový backend nepřidá ani z trezoru", async () => {
    zapojCtecku();
    process.env.AISHA_EXECUTION_MODE = "local";
    trezor.set("ANTHROPIC_API_KEY", "SENTINEL-trezor-anthropic");
    const r = new BackendRegistry();
    await r.reconcileCredentialBackends();
    expect(idcka(r)).not.toContain("anthropic");
  });
});
