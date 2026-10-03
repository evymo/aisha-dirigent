/**
 * Gate: rozměr korpusového sloupce musí sedět na rozměr modelu, který ho plní.
 *
 * PROČ (změřeno 2026-07-30)
 * ------------------------
 * `knowledge_embeddings.embedding` byl `vector(1536)` — tvar po
 * `text-embedding-3-small`, tedy po cloudu. Instance ale embeduje LOKÁLNĚ modelem
 * bge-m3, který dává 1024. Neshoda se neprojevila nikde: schéma bylo platné,
 * registr platný, brány zelené — a vektorová vrstva zůstala prázdná, protože
 * Postgres odmítl každý zápis. Trvalo to, než se to našlo, právě proto, že
 * mezi „sloupec" a „model" nevedla žádná kontrola.
 *
 * Druhá půlka téže vady: `fn_resolve_embedding_model` mapovala prostor jako
 * `CASE WHEN dim = 2560 THEN 'v2' ELSE 'v1'`. To není derivace, ale dvouhodnotová
 * tabulka — KAŽDÝ jiný rozměr mlčky prohlásila za v1. Model s 1024 tak dostal
 * nálepku prostoru, do kterého se nevejde.
 *
 * Brána proto drží tři věci u sebe:
 *   1. rozměry sloupců v SoT (`vector(N)` / `halfvec(N)`),
 *   2. rozměry modelů v seedu (`embedding_dimensions` + deklarovaný `rag_space`),
 *   3. mapování rozměr → prostor v resolveru.
 *
 * Nedrží se jedna KONKRÉTNÍ hodnota (to by byla brána na pravopis) — drží se
 * VLASTNOST: každý prostor má právě jeden rozměr a každý model, který tvrdí, že
 * do prostoru patří, ten rozměr má.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Rozměr korpusového sloupce ze SoT — zdroj pravdy o prostoru. */
function dimSloupce(soubor: string, sloupec: string): number | null {
  const src = read(soubor);
  const m = src.match(new RegExp(`\\b${sloupec}\\s+(?:vector|halfvec)\\((\\d+)\\)`));
  return m ? Number(m[1]) : null;
}

/**
 * Modely ze seedu: model_id → {dim, rag_space}.
 *
 * Řádky se dělí po `::jsonb),`, tedy po skutečné hranici jedné VALUES položky.
 * První verze hledala vzor `[\s\S]*?` napříč zdrojem a přeskočila hranici řádku:
 * spárovala `model_id` jednoho modelu s `context_window` druhého a ohlásila
 * „gpt-5-mini: dim 128000" — model, který embedding vůbec není. Falešný nález
 * z hladového regexu vypadá stejně přesvědčivě jako pravdivý, proto se hranice
 * musí držet strukturou, ne doufáním.
 */
function modelySeedu(): Map<string, { dim: number; space: string | null }> {
  const src = read("aisha/db/seed/core/20_aisha_backbone.sql");
  const out = new Map<string, { dim: number; space: string | null }>();
  for (const radek of src.split("::jsonb),")) {
    // Segment může obsahovat víc VALUES řádků (jen ten POSLEDNÍ končí tím
    // `::jsonb),`, na kterém se dělí). Identita i rozměr se proto berou z
    // POSLEDNÍHO výskytu — jinak se spáruje model_id jednoho řádku s číslem
    // druhého. Přesně tak vzniklo „bge-m3-embedding: dim 128000", kde 128 000
    // je context_window úplně jiného modelu.
    const capsAll = [...radek.matchAll(/false,\s*true,\s*(\d+),/g)];
    if (!capsAll.length) continue;
    const rag = radek.match(/"rag_space":\s*(null|"[^"]*")/);
    if (!rag) continue;
    const ids = [...radek.matchAll(/\(\s*'([^']+)',\s*'([^']+)'/g)];
    if (!ids.length) continue;
    out.set(ids[ids.length - 1][2], {
      dim: Number(capsAll[capsAll.length - 1][1]),
      space: rag[1] === "null" ? null : rag[1].replace(/"/g, ""),
    });
  }
  return out;
}

/** Mapování rozměr → prostor, jak ho vydá resolver. */
function mapovaniResolveru(): Map<number, string> {
  const src = read("aisha/db/sql/functions/fn_resolve_embedding_model.sql");
  const out = new Map<number, string>();
  for (const m of src.matchAll(/WHEN\s+(\d+)\s+THEN\s+'(v\d)'/g)) out.set(Number(m[1]), m[2]);
  return out;
}

const PROSTORY: Record<string, number | null> = {
  v1: dimSloupce("aisha/db/sql/tables/knowledge_embeddings.sql", "embedding"),
  v2: dimSloupce("aisha/db/sql/tables/knowledge_embeddings.sql", "embedding_v2"),
};

describe("embedding prostor sedí na model, který ho plní", () => {
  it("brána má co měřit — oba prostory se ze SoT přečetly", () => {
    // Prázdno by prošlo jako „nic není rozbité"; musí být vidět, CO se měří.
    expect(PROSTORY.v1, "rozměr v1 se ze SoT nepodařilo přečíst").toBeTypeOf("number");
    expect(PROSTORY.v2, "rozměr v2 se ze SoT nepodařilo přečíst").toBeTypeOf("number");
    expect(modelySeedu().size, "v seedu nejsou žádné embedding modely").toBeGreaterThan(0);
    console.log(`  prostory: v1=${PROSTORY.v1}, v2=${PROSTORY.v2}`);
  });

  it("resolver mapuje každý prostor na jeho SKUTEČNÝ rozměr", () => {
    const mapovani = mapovaniResolveru();
    const chyby: string[] = [];
    for (const [space, dim] of Object.entries(PROSTORY)) {
      const dleResolveru = [...mapovani.entries()].filter(([, s]) => s === space).map(([d]) => d);
      if (!dleResolveru.includes(dim as number)) {
        chyby.push(
          `${space}: sloupec má ${dim}, resolver na ${space} mapuje ${JSON.stringify(dleResolveru)}`,
        );
      }
    }
    expect(chyby, `Rozměr sloupce a mapování resolveru se rozešly:\n  ${chyby.join("\n  ")}`)
      .toEqual([]);
  });

  it("žádný model netvrdí prostor, do kterého se svým rozměrem nevejde", () => {
    const chyby: string[] = [];
    for (const [model, { dim, space }] of modelySeedu()) {
      if (space === null) continue; // vědomě mimo zdejší prostory — legitimní
      const ocekavany = PROSTORY[space];
      if (ocekavany === undefined) {
        chyby.push(`${model}: hlásí prostor '${space}', který v SoT neexistuje`);
      } else if (ocekavany !== dim) {
        chyby.push(`${model}: dim ${dim}, ale prostor '${space}' má ${ocekavany}`);
      }
    }
    expect(
      chyby,
      "Model deklaruje prostor, jehož rozměr nemá — zápis vektoru Postgres odmítne " +
        "a projeví se to až v runtime:\n  " + chyby.join("\n  "),
    ).toEqual([]);
  });

  it("každý prostor má právě jeden rozměr (dva by znamenaly dvě pravdy)", () => {
    const mapovani = mapovaniResolveru();
    const dleProstoru = new Map<string, number[]>();
    for (const [dim, space] of mapovani) {
      dleProstoru.set(space, [...(dleProstoru.get(space) ?? []), dim]);
    }
    const vic = [...dleProstoru.entries()].filter(([, dims]) => dims.length > 1);
    expect(vic, `Prostor s víc rozměry: ${JSON.stringify(vic)}`).toEqual([]);
  });
});
