/**
 * Kanál z faktů (fáze 4 „AI na CPU") — model je jen jazyk, čísla hlídá server.
 *
 * Měří se chování `odpovedZFaktu` nad podvrženým blokem a modelem:
 *   - fakta se čtou z BLOKU Asku (`get_block_data`) pod uživatelem, s týmiž
 *     parametry jako Ask (`{question}`) — blok přilévá své parametry (pohledávky);
 *   - text modelu s číslem mimo fakta se k uživateli NEDOSTANE (kontrolní vzorek);
 *   - „bez formulace" (pokrytí none), obsazený model a příliš dlouhá fakta model
 *     VŮBEC nevolají;
 *   - chyba bloku/modelu se nemaskuje (route ji vrátí, klient ukáže svá fakta);
 *   - deklarace kanálu, které nerozumíme, je chyba — ne tiché vypnutí hlídání.
 *
 * Tvar bloku = `get_answer_block` (sloupce odpoved · pokryti · zdroj).
 */
import { describe, expect, it } from "vitest";
import { _bezicichFormulaci, groundingFromChannel, odpovedZFaktu, type GroundedDeps } from "../lib/groundedAnswer.js";

const ODPOVED = "Inspirace: dluh (po splatnosti) 194 360 Kč, nejstarší 686 dní (od 11. 11. 2024); k úhradě celkem 259 597 Kč.";
const blok = (odpoved: string, pokryti = "partial") => ({
  data: {
    columns: [{ key: "odpoved", label_key: "app.cols.answer" }, { key: "pokryti" }, { key: "zdroj" }],
    rows: [{ odpoved, pokryti, zdroj: "get_counterparty_metric" }],
  },
  provenance: { source_slug: "answer_verified_facts", trace_id: "answer_chain:answer", freshness_at: "2026-09-29T06:00:00Z" },
});
const BLOK = blok(ODPOVED);
const DEKLARACE = {
  facts_block: "ask_answer", numbers: "strict", max_concurrent: 1, skip_model_when: { pokryti: ["none"] },
};
const CFG = groundingFromChannel({ grounding: DEKLARACE })!;
const VSTUP = { question: "Kolik dluží Inspirace?", systemPrompt: "Odpovídej jen z faktů." };

function deps(text: string, data: unknown = BLOK) {
  const volani: { rpc: Array<[string, Record<string, unknown>]>; llm: Array<[string, string]> } = { rpc: [], llm: [] };
  const d: GroundedDeps = {
    rpcUser: async (fn, args) => {
      volani.rpc.push([fn, args]);
      return { data, error: null };
    },
    llm: async (system, otazka) => {
      volani.llm.push([system, otazka]);
      return { text, inputTokens: 400, outputTokens: 40, model: "default-lens" };
    },
  };
  return { d, volani };
}

describe("odpověď z faktů: model formuluje, server hlídá čísla", () => {
  it("fakta jdou z bloku deklarovaného kanálem, s týmiž parametry jako Ask", async () => {
    const { d, volani } = deps("Inspirace dluží 194 360 Kč po splatnosti.");
    await odpovedZFaktu(CFG, d, VSTUP);
    expect(volani.rpc).toEqual([["get_block_data", { p_block_slug: "ask_answer", p_params: { question: VSTUP.question } }]]);
    expect(volani.llm[0][0]).toContain("Odpovídej jen z faktů.");
    expect(volani.llm[0][0]).toContain("194 360 Kč");
    expect(volani.llm[0][1]).toBe(VSTUP.question);
  });

  it("scope z požadavku jde do parametrů bloku (jen když ho klient poslal)", async () => {
    const { d, volani } = deps("Dluh 194 360 Kč.");
    await odpovedZFaktu(CFG, d, { ...VSTUP, scope: { firma: "09519696" } });
    expect(volani.rpc[0][1]).toEqual({ p_block_slug: "ask_answer", p_params: { question: VSTUP.question, scope: { firma: "09519696" } } });
  });

  it("text modelu jen s hodnotami z faktů se vrátí jako odpověď", async () => {
    const r = await odpovedZFaktu(CFG, deps("Inspirace dluží 194 360 Kč od 11. 11. 2024, nejdéle 686 dní.").d, VSTUP);
    expect(r.content).toBe("Inspirace dluží 194 360 Kč od 11. 11. 2024, nejdéle 686 dní.");
    expect(r.factsAnswer).toBe(ODPOVED);
    expect(r.grounding).toEqual({ block: "ask_answer", source: "answer_verified_facts", verdict: "model", reason: "model", cizi: [] });
    expect(r.usage).toEqual({ inputTokens: 400, outputTokens: 40 });
  });

  it("KONTROLNÍ VZOREK: vymyšlená částka → uživatel dostane fakta, cizí hodnota v provenienci", async () => {
    const r = await odpovedZFaktu(CFG, deps("Inspirace dluží 195 000 Kč.").d, VSTUP);
    expect(r.content).toBe(ODPOVED);
    expect(r.grounding).toMatchObject({ verdict: "fakta", reason: "cizi_cisla", cizi: ["195 000"] });
  });

  it("KONTROLNÍ VZOREK: datum z provenience (freshness_at) NENÍ fakt pro model", async () => {
    const r = await odpovedZFaktu(CFG, deps("Data jsou k 29. 9. 2026.").d, VSTUP);
    expect(r.grounding).toMatchObject({ verdict: "fakta", reason: "cizi_cisla" });
  });

  it("prázdný text modelu → fakta", async () => {
    const r = await odpovedZFaktu(CFG, deps("   ").d, VSTUP);
    expect(r.grounding).toMatchObject({ verdict: "fakta", reason: "prazdna_odpoved" });
  });

  it("řádek podle skip_model_when (pokrytí none) → model se nevolá", async () => {
    const { d, volani } = deps("cokoli", blok("To v datech nemám.", "none"));
    const r = await odpovedZFaktu(CFG, d, VSTUP);
    expect(volani.llm).toHaveLength(0);
    expect(r).toMatchObject({ content: "To v datech nemám.", grounding: { reason: "bez_formulace" } });
  });

  it("fakta nad max_facts_chars → model se nevolá", async () => {
    const cfg = groundingFromChannel({ grounding: { ...DEKLARACE, max_facts_chars: 50 } })!;
    const { d, volani } = deps("cokoli");
    const r = await odpovedZFaktu(cfg, d, VSTUP);
    expect(volani.llm).toHaveLength(0);
    expect(r.grounding.reason).toBe("fakta_prilis_dlouha");
  });

  it("souběh nad max_concurrent → druhý dostane fakta hned, model běží jen jednou", async () => {
    let pust!: () => void;
    const brana = new Promise<void>((r) => { pust = r; });
    let llmVolani = 0;
    const d: GroundedDeps = {
      rpcUser: async () => ({ data: BLOK, error: null }),
      llm: async () => { llmVolani++; await brana; return { text: "Dluh 194 360 Kč.", inputTokens: 1, outputTokens: 1, model: "m" }; },
    };
    const prvni = odpovedZFaktu(CFG, d, VSTUP);
    await new Promise((r) => setTimeout(r, 0));
    const druhy = await odpovedZFaktu(CFG, d, VSTUP);
    expect(druhy.grounding.reason).toBe("model_obsazen");
    expect(druhy.content).toBe(ODPOVED);
    pust();
    expect((await prvni).grounding.reason).toBe("model");
    expect(llmVolani).toBe(1);
    expect(_bezicichFormulaci()).toBe(0);
  });

  it("chyba modelu se nemaskuje a uvolní místo pro další formulaci", async () => {
    const d: GroundedDeps = {
      rpcUser: async () => ({ data: BLOK, error: null }),
      llm: async () => { throw new Error("AI timeout"); },
    };
    await expect(odpovedZFaktu(CFG, d, VSTUP)).rejects.toThrow("AI timeout");
    expect(_bezicichFormulaci()).toBe(0);
  });

  it("chyba bloku se nemaskuje; prázdný blok (bez práva / bez otázky) je chyba, ne formulace", async () => {
    const chyba: GroundedDeps = {
      rpcUser: async () => ({ data: null, error: { message: "permission denied" } }),
      llm: async () => ({ text: "x", inputTokens: 0, outputTokens: 0, model: "m" }),
    };
    await expect(odpovedZFaktu(CFG, chyba, VSTUP)).rejects.toThrow("blok ask_answer: permission denied");
    const prazdny = deps("x", { data: { columns: [{ key: "odpoved" }], rows: [] }, provenance: {} });
    await expect(odpovedZFaktu(CFG, prazdny.d, VSTUP)).rejects.toThrow(/nevrátil odpověď/);
    expect(prazdny.volani.llm).toHaveLength(0);
  });
});

describe("deklarace kanálu guardrails.grounding", () => {
  it("bez deklarace → null (kanál běží po staru)", () => {
    expect(groundingFromChannel({ max_message_length: 2000 })).toBeNull();
    expect(groundingFromChannel(null)).toBeNull();
  });

  it("výchozí max_concurrent 1, bez stropu faktů, bez skip", () => {
    expect(groundingFromChannel({ grounding: { facts_block: "ask_answer", numbers: "strict" } })).toEqual({
      factsBlock: "ask_answer", numbers: "strict", maxConcurrent: 1, maxFactsChars: null, skipModelWhen: {},
    });
  });

  it("deklarace, které nerozumíme, je chyba — ne tiché vypnutí hlídání", () => {
    expect(() => groundingFromChannel({ grounding: { facts_block: "ask_answer", numbers: "loose" } })).toThrow(/strict/);
    expect(() => groundingFromChannel({ grounding: { facts_block: "x; drop table", numbers: "strict" } })).toThrow(/facts_block/);
    expect(() => groundingFromChannel({ grounding: { facts_rpc: "answer_verified_facts", numbers: "strict" } })).toThrow(/facts_block/);
    expect(() => groundingFromChannel({ grounding: { ...DEKLARACE, max_concurrent: 0 } })).toThrow(/max_concurrent/);
    expect(() => groundingFromChannel({ grounding: { ...DEKLARACE, skip_model_when: { pokryti: "none" } } })).toThrow(/skip_model_when/);
    expect(() => groundingFromChannel({ grounding: "ano" })).toThrow(/objekt/);
  });
});
