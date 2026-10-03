/**
 * Odpověď z faktů — kanál, ve kterém je model JEN jazyk (fáze 4 „AI na CPU").
 *
 * Majitel 2026-09-29: Ask ukáže fakta z DB hned, model je smí jen přeformulovat,
 * hlídání čísel přísně. Kanál to deklaruje v `guardrails.grounding` (instanční
 * data, ne kód):
 *
 *   "grounding": {
 *     "facts_block": "ask_answer",            // blok, ze kterého fakta čte i Ask
 *     "numbers": "strict",                    // jediný režim: cizí číslo = zahodit
 *     "max_concurrent": 1,                    // kolik formulací smí běžet naráz (CPU)
 *     "max_facts_chars": 3000,                // delší fakta model nedostane (vstup na CPU)
 *     "skip_model_when": {"pokryti": ["none"]} // řádek faktů, u kterého model nic nepřidá
 *   }
 *
 * PROČ BLOK, NE PŘÍMO RPC: Ask čte fakta přes `get_block_data(blok, {question})`
 * a blok k otázce přilévá SVÉ parametry (u `ask_answer` od kdy je faktura
 * pohledávkou, storno hodnoty, vzory nájmů). Přímé volání odpovídače by počítalo
 * bez nich — model by formuloval jiná čísla, než uživatel vidí. Tatáž cesta =
 * tatáž fakta, pod týmž oprávněním (token uživatele).
 *
 * Pořadí: fakta z bloku → (deklarované „bez formulace" / model obsazený / fakta
 * příliš dlouhá → rovnou fakta) → jedno volání modelu bez nástrojů → hlídač čísel
 * → text modelu, nebo deterministická odpověď faktů. Chyba bloku nebo modelu se
 * NEMASKUJE — route ji vrátí jako chybu a klient ukáže fakta, která už má.
 *
 * @module
 */
import { hlidejCisla } from "./factNumberGuard.js";

/** Deklarace kanálu po ověření. */
export interface GroundingConfig {
  factsBlock: string;
  numbers: "strict";
  maxConcurrent: number;
  maxFactsChars: number | null;
  /** Sloupec řádku faktů → hodnoty, při kterých se model nevolá. */
  skipModelWhen: Record<string, string[]>;
}

const JMENO = /^[a-z_][a-z0-9_]*$/;

/**
 * Přečte `guardrails.grounding` kanálu. Bez deklarace → null (kanál běží po
 * staru). Deklarace, které nerozumíme, je CHYBA — žádné tiché „tak bez hlídání".
 */
export function groundingFromChannel(guardrails: unknown): GroundingConfig | null {
  const g = (guardrails as { grounding?: unknown } | null | undefined)?.grounding;
  if (g == null) return null;
  if (typeof g !== "object" || Array.isArray(g)) throw new Error("[grounding] guardrails.grounding musí být objekt");
  const o = g as Record<string, unknown>;
  if (typeof o.facts_block !== "string" || !JMENO.test(o.facts_block)) {
    throw new Error(`[grounding] facts_block musí být slug bloku (a-z, 0-9, _), dostal ${JSON.stringify(o.facts_block)}`);
  }
  if (o.numbers !== "strict") {
    throw new Error(`[grounding] numbers umí jen "strict", dostal ${JSON.stringify(o.numbers)}`);
  }
  const maxConcurrent = o.max_concurrent ?? 1;
  if (!Number.isInteger(maxConcurrent) || (maxConcurrent as number) < 1) {
    throw new Error(`[grounding] max_concurrent musí být celé číslo ≥ 1, dostal ${JSON.stringify(o.max_concurrent)}`);
  }
  const maxFactsChars = o.max_facts_chars ?? null;
  if (maxFactsChars !== null && (!Number.isInteger(maxFactsChars) || (maxFactsChars as number) < 1)) {
    throw new Error(`[grounding] max_facts_chars musí být celé číslo ≥ 1, dostal ${JSON.stringify(o.max_facts_chars)}`);
  }
  const skip = o.skip_model_when ?? {};
  if (
    typeof skip !== "object" || skip === null || Array.isArray(skip) ||
    !Object.values(skip).every((v) => Array.isArray(v) && v.every((x) => typeof x === "string"))
  ) {
    throw new Error(`[grounding] skip_model_when musí být {sloupec: [hodnoty]}, dostal ${JSON.stringify(o.skip_model_when)}`);
  }
  return {
    factsBlock: o.facts_block,
    numbers: "strict",
    maxConcurrent: maxConcurrent as number,
    maxFactsChars: maxFactsChars as number | null,
    skipModelWhen: skip as Record<string, string[]>,
  };
}

/** Tabulkový blok (kontrakt povrchu): odpověď = první sloupec prvního řádku — jako Ask. */
interface BlokFaktu {
  data?: { columns?: Array<{ key?: unknown }>; rows?: Array<Record<string, unknown>> };
  provenance?: { source_slug?: unknown };
}

export interface GroundedDeps {
  /** RPC pod oprávněním uživatele (pgrestUser), NIKDY servisní rovina. */
  rpcUser: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** Jedno volání modelu bez nástrojů. */
  llm: (systemPrompt: string, question: string) => Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }>;
}

export type GroundedReason =
  | "model"               // text modelu prošel hlídačem
  | "cizi_cisla"          // model napsal číslo/datum mimo fakta → fakta
  | "prazdna_odpoved"     // model nic nenapsal → fakta
  | "bez_formulace"       // řádek faktů odpovídá skip_model_when → model se nevolá
  | "model_obsazen"       // běží max_concurrent formulací → fakta hned
  | "fakta_prilis_dlouha" // vstup nad max_facts_chars → model se nevolá
  | "aitg_strazce";       // text modelu zastavil výstupní strážce AITG (nastaví route) → fakta

export interface GroundedResult {
  content: string;
  /** Deterministická odpověď faktů — vždy, i když `content` je text modelu. */
  factsAnswer: string;
  grounding: {
    block: string;
    source: string | null;
    verdict: "model" | "fakta";
    reason: GroundedReason;
    /** Hodnoty, které model přidal navíc (bez textu odpovědi). */
    cizi: string[];
  };
  usage: { inputTokens: number; outputTokens: number };
  model: string | null;
}

/** Počet právě běžících formulací v tomhle procesu (ochrana CPU, fáze 2). */
let bezi = 0;
/** Jen pro testy. */
export function _bezicichFormulaci(): number {
  return bezi;
}

export async function odpovedZFaktu(
  cfg: GroundingConfig,
  deps: GroundedDeps,
  vstup: { question: string; scope?: Record<string, unknown> | null; systemPrompt: string },
): Promise<GroundedResult> {
  // Tytéž parametry, které posílá Ask (`{question}`); scope jen když ho klient poslal.
  const pParams: Record<string, unknown> = { question: vstup.question };
  if (vstup.scope) pParams.scope = vstup.scope;
  const { data, error } = await deps.rpcUser("get_block_data", { p_block_slug: cfg.factsBlock, p_params: pParams });
  if (error) throw new Error(`[grounding] blok ${cfg.factsBlock}: ${error.message}`);
  const blok = (typeof data === "string" ? JSON.parse(data) : data) as BlokFaktu | null;
  const klic = blok?.data?.columns?.[0]?.key;
  const radek = blok?.data?.rows?.[0];
  const odpoved = typeof klic === "string" && radek ? radek[klic] : undefined;
  if (typeof odpoved !== "string" || !odpoved.trim()) {
    throw new Error(`[grounding] blok ${cfg.factsBlock} nevrátil odpověď (první sloupec prvního řádku)`);
  }
  const fakta = radek as Record<string, unknown>;
  const zdroj = typeof blok?.provenance?.source_slug === "string" ? blok.provenance.source_slug : null;

  const zFaktu = (reason: GroundedReason, cizi: string[] = [], usage = { inputTokens: 0, outputTokens: 0 }, model: string | null = null): GroundedResult => ({
    content: odpoved,
    factsAnswer: odpoved,
    grounding: { block: cfg.factsBlock, source: zdroj, verdict: "fakta", reason, cizi },
    usage,
    model,
  });

  for (const [sloupec, hodnoty] of Object.entries(cfg.skipModelWhen)) {
    if (hodnoty.includes(String(fakta[sloupec]))) return zFaktu("bez_formulace");
  }
  const faktaJson = JSON.stringify(fakta);
  if (cfg.maxFactsChars !== null && faktaJson.length > cfg.maxFactsChars) return zFaktu("fakta_prilis_dlouha");
  if (bezi >= cfg.maxConcurrent) return zFaktu("model_obsazen");

  bezi++;
  let r: Awaited<ReturnType<GroundedDeps["llm"]>>;
  try {
    r = await deps.llm(`${vstup.systemPrompt}\n\n## FAKTA (jediný zdroj čísel, dat a jmen)\n${faktaJson}`, vstup.question);
  } finally {
    bezi--;
  }
  const usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  const text = r.text.trim();
  if (!text) return zFaktu("prazdna_odpoved", [], usage, r.model);
  const verdikt = hlidejCisla(text, fakta, vstup.question);
  if (!verdikt.ok) return zFaktu("cizi_cisla", verdikt.cizi, usage, r.model);
  return {
    content: text,
    factsAnswer: odpoved,
    grounding: { block: cfg.factsBlock, source: zdroj, verdict: "model", reason: "model", cizi: [] },
    usage,
    model: r.model,
  };
}
