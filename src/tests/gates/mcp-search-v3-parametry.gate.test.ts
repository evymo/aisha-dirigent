/**
 * Brána: každý parametr mcp_search_knowledge_v3 má plniče — nebo je jmenovaná výjimka
 *
 * Parametr, který funkce přijme a mlčky ignoruje, vypadá pro volajícího jako filtr.
 * Změřeno 2026-10-04: `p_expertise_slug` a `p_include_ai_instructions` funkce přijímala
 * a nepoužila; `p_item_types = '{}'` (to posílá volající, když typy nezadá) naopak
 * odfiltrovalo VŠECHNO. Hledání má dvě větve (embedding v1 a v2) — parametr, který
 * filtruje jen v jedné, je táž vada v polovině případů.
 *
 * Pravidlo: každý parametr signatury má tady zapsáno, KDE ho tělo používá. Nový parametr
 * bez zápisu = pád; zápis, který neodpovídá tělu = pád; výjimka, kterou tělo používá = pád
 * (výjimku smaž).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripSqlComments } from "../../../scripts/db/lib/sql-comments.mjs";

const SOUBOR = join(process.cwd(), "aisha/db/sql/functions/mcp_search_knowledge_v3.sql");

type Kde = "obe-vetve" | "uvod" | "vetev-v1" | "vetev-v2" | "vyjimka";

/** Parametr → kde ho tělo používá. U výjimky důvod, proč funkce parametr přijímá a nepoužívá. */
const POUZITI: Record<string, { kde: Kde; proc?: string }> = {
  p_query_embedding_v1: { kde: "vetev-v1" },
  p_query_embedding_v2: { kde: "vetev-v2" },
  p_item_types: { kde: "obe-vetve" },
  p_category: { kde: "obe-vetve" },
  p_expertise_slug: { kde: "obe-vetve" },
  p_include_ai_instructions: { kde: "obe-vetve" },
  p_limit: { kde: "obe-vetve" },
  p_similarity_threshold: { kde: "obe-vetve" },
  p_story_id: { kde: "obe-vetve" },
  p_query_model: { kde: "obe-vetve" },
  p_locale: { kde: "obe-vetve" },
  p_model_pref: { kde: "uvod" },
  p_audience_user_id: { kde: "uvod" },
  p_query_text: {
    kde: "vyjimka",
    proc: "v3 je čistě vektorové hledání; text nefiltruje ani neřadí (textová záloha při výpadku embeddingu je od 2026-10-06 zrušená — P2, selhání nahlas)",
  },
  p_context_tags: {
    kde: "vyjimka",
    proc: "ani ve v2 štítky nefiltrují (jen přidávají body pořadí); v3 řadí vzdáleností vektoru a bodování štítků nemá",
  },
};

type Rozbor = { parametry: string[]; uvod: string; v2: string; v1: string };

/** Signatura a tělo rozdělené na úvod (před větvením), větev embeddingu v2 a větev v1. */
function rozeber(sql: string): Rozbor | null {
  const cisty = stripSqlComments(sql);
  const sig = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.mcp_search_knowledge_v3\(([\s\S]*?)\)\s*RETURNS\s+TABLE/i.exec(cisty);
  const telo = /AS\s+\$function\$([\s\S]*?)\$function\$/i.exec(cisty);
  if (!sig || !telo) return null;
  const parametry = [...sig[1].matchAll(/\b(p_[a-z0-9_]+)\b\s+[a-z]/gi)].map((m) => m[1]);
  const vetveni = /\bIF\s+p_model_pref\s*=\s*'v2'\s+THEN\b/i.exec(telo[1]);
  if (!vetveni) return null;
  const poVetveni = telo[1].slice(vetveni.index + vetveni[0].length);
  // Větve dělí ELSE na úrovni větvení (dvě mezery odsazení); vnořená CASE … ELSE jsou odsazená víc.
  const delic = /\n {2}ELSE\n/.exec(poVetveni);
  if (!delic) return null;
  return {
    parametry: [...new Set(parametry)],
    uvod: telo[1].slice(0, vetveni.index + vetveni[0].length),
    v2: poVetveni.slice(0, delic.index),
    v1: poVetveni.slice(delic.index),
  };
}

const pouzit = (text: string, p: string) => new RegExp(`\\b${p}\\b`).test(text);

/** Odchylky mezi zápisem POUZITI a tělem. Čistá funkce — brána i její kotva měří touž. */
function vady(r: Rozbor, zapis: Record<string, { kde: Kde; proc?: string }>): string[] {
  const out: string[] = [];
  for (const p of r.parametry) {
    const z = zapis[p];
    if (!z) {
      out.push(`${p}: parametr bez zápisu — doplň, kde ho tělo používá, nebo výjimku s důvodem`);
      continue;
    }
    const [u, a, b] = [pouzit(r.uvod, p), pouzit(r.v2, p), pouzit(r.v1, p)];
    if (z.kde === "vyjimka") {
      if (u || a || b) out.push(`${p}: je ve výjimkách, ale tělo ho používá — výjimku smaž`);
      if (!z.proc) out.push(`${p}: výjimka bez důvodu`);
    } else if (z.kde === "obe-vetve" && !(a && b)) out.push(`${p}: má být v OBOU větvích (v2: ${a}, v1: ${b})`);
    else if (z.kde === "uvod" && !u) out.push(`${p}: má být použit v úvodu funkce`);
    else if (z.kde === "vetev-v1" && !b) out.push(`${p}: má být použit ve větvi embeddingu v1`);
    else if (z.kde === "vetev-v2" && !a) out.push(`${p}: má být použit ve větvi embeddingu v2`);
  }
  for (const p of Object.keys(zapis)) if (!r.parametry.includes(p)) out.push(`${p}: zápis neodpovídá žádnému parametru — smaž ho`);
  return out;
}

describe("mcp_search_knowledge_v3: každý parametr má plniče nebo jmenovanou výjimku", () => {
  const r = rozeber(readFileSync(SOUBOR, "utf-8"));

  it("měřák funkci rozebral: 15 parametrů a obě větve (kotva)", () => {
    expect(r, "signaturu, tělo nebo větvení `IF p_model_pref = 'v2' THEN … ELSE` se nepodařilo najít").not.toBeNull();
    expect(r!.parametry).toHaveLength(15);
    expect(r!.v2).toMatch(/embedding_v2\s*<=>/);
    expect(r!.v1).toMatch(/ke\.embedding\s*<=>/);
    expect(r!.v1).not.toMatch(/embedding_v2\s*<=>/);
  });

  it("kotva měřidla: parametr bez plniče, jen v jedné větvi, bez zápisu i použitá výjimka jsou nález", () => {
    const vzor = (v2: string, v1: string) =>
      rozeber(`CREATE OR REPLACE FUNCTION public.mcp_search_knowledge_v3(p_a text DEFAULT NULL, p_b text DEFAULT NULL)
 RETURNS TABLE(x uuid) LANGUAGE plpgsql AS $function$
BEGIN
  IF p_model_pref = 'v2' THEN
    RETURN QUERY SELECT 1 WHERE ${v2};
  ELSE
    RETURN QUERY SELECT 1 WHERE ${v1};
  END IF;
END;
$function$;`)!;
    const oba = { p_a: { kde: "obe-vetve" as Kde }, p_b: { kde: "obe-vetve" as Kde } };
    expect(vady(vzor("p_a = 1 AND p_b = 2", "p_a = 1 AND p_b = 2"), oba)).toEqual([]);
    expect(vady(vzor("p_a = 1 AND p_b = 2", "p_a = 1"), oba)).toHaveLength(1); // p_b jen v jedné větvi
    expect(vady(vzor("p_a = 1", "p_a = 1"), oba)).toHaveLength(1); // p_b bez plniče
    expect(vady(vzor("p_a = 1 AND p_b = 2", "p_a = 1 AND p_b = 2"), { p_a: { kde: "obe-vetve" } })).toHaveLength(1); // p_b bez zápisu
    expect(vady(vzor("p_a = 1 AND p_b = 2", "p_a = 1 AND p_b = 2"), { ...oba, p_b: { kde: "vyjimka", proc: "důvod" } })).toHaveLength(1); // výjimka, kterou tělo používá
    expect(vady(vzor("p_a = 1", "p_a = 1"), { ...oba, p_b: { kde: "vyjimka", proc: "důvod" } })).toEqual([]);
    expect(vady(vzor("p_a = 1", "p_a = 1"), { ...oba, p_b: { kde: "vyjimka" } })).toHaveLength(1); // výjimka bez důvodu
    // Zmínka jen v komentáři se nepočítá.
    expect(vady(vzor("p_a = 1 -- p_b", "p_a = 1 -- p_b"), oba)).toHaveLength(1);
  });

  it("zápis POUZITI odpovídá tělu funkce", () => {
    expect(vady(r!, POUZITI), "Parametr mcp_search_knowledge_v3 bez plniče (nebo zápis, který neodpovídá tělu).").toEqual([]);
  });
});
