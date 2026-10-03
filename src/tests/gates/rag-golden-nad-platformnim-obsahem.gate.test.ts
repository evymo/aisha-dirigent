/**
 * Brána: RAG golden set má v obou jazycích dost otázek nad obsahem, který seeduje PLATFORMA.
 *
 * ⛔ NAMĚŘENO 2026-09-13. `aisha/db/seed/core/31_rag_eval_golden.sql` nesl 24 otázek,
 * 20 s `expected_chunk_slugs` — ale 15 z nich odkazovalo (26 labelů) na slugy, které
 * seed/core nezakládá: expert_rules z DEMO seedu (seed/demo/02_expert_rules.sql, do
 * knowledge_items je zrcadlí trigger; na čisté DB s demo seedem se najdou všechny). Produkční profil
 * demo neseeduje, takže na instanci, jejíž overlay tytéž slugy nenese, mají recall 0 pro
 * KAŽDÝ embedding model; skupiny repo_plus_rules a evidence_strict tam srovnání
 * (`fn_compare_rag_embedding_models`) vždy vyhodnotí „tie". Česky byly nad platformním
 * obsahem označené jen 2 otázky.
 *
 * Ty řádky se nemění (kde obsah je, měří správně). Brána drží, co musí platit VŠUDE:
 *   · každý jazyk má ≥ 6 označených otázek, jejichž VŠECHNY labely jsou aktivní
 *     knowledge_items ze seed/core (bez podmínky na každé instanci, embeduje je krok 6b),
 *   · platformní sada (`plat-*`) nesmí sklouznout k obsahu mimo seed/core,
 *   · aspoň jedna anglická otázka míří na česky psaný obsah (mezijazyčné vyhledávání).
 * Měří se vlastnost celé sady, ne seznam jmen.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CORE = join(ROOT, "aisha/db/seed/core");
const GOLDEN = join(CORE, "31_rag_eval_golden.sql");

/**
 * Projde SQL mimo řetězce a komentáře; `naUrovni(i)` se volá pro každý znak v nejvyšší
 * úrovni závorek. Vrací index, kde `naUrovni` vrátilo true, nebo -1.
 */
function prochazej(text: string, naUrovni: (i: number, hloubka: number) => boolean): number {
  let hloubka = 0;
  let vRetezci = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (vRetezci) {
      if (c === "'" && text[i + 1] === "'") i++;
      else if (c === "'") vRetezci = false;
      continue;
    }
    if (c === "-" && text[i + 1] === "-") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === "'") vRetezci = true;
    else if (c === "(" || c === "[") hloubka++;
    else if (c === ")" || c === "]") hloubka--;
    else if (naUrovni(i, hloubka)) return i;
  }
  return -1;
}

/** Rozdělí text na prvky nejvyšší úrovně podle oddělovače, s ohledem na SQL řetězce a závorky. */
function rozdel(text: string, oddelovac: string): string[] {
  const out: string[] = [];
  let zacatek = 0;
  prochazej(text, (i, hloubka) => {
    if (text[i] === oddelovac && hloubka === 0) {
      out.push(text.slice(zacatek, i));
      zacatek = i + 1;
    }
    return false;
  });
  out.push(text.slice(zacatek));
  return out.map((s) => s.replace(/^\s*(--[^\n]*\n\s*)*/, "").trim()).filter(Boolean);
}

/** N-tice VALUES jednoho INSERTu: [sloupce, řádky prvků]. */
function inserty(sql: string, tabulka: string): Array<{ sloupce: string[]; radky: string[][] }> {
  const out: Array<{ sloupce: string[]; radky: string[][] }> = [];
  const re = new RegExp(`INSERT INTO public\\.${tabulka}\\s*\\(([^)]*)\\)\\s*VALUES`, "g");
  for (const m of sql.matchAll(re)) {
    const sloupce = m[1].split(",").map((s) => s.trim());
    // Tělo VALUES končí na ON CONFLICT nebo `;` NEJVYŠŠÍ úrovně — ne uvnitř řetězce
    // (těla dokumentů „ON CONFLICT" i středníky běžně obsahují).
    const zbytek = sql.slice((m.index ?? 0) + m[0].length);
    const konec = prochazej(zbytek, (i, hloubka) => hloubka === 0 && (zbytek[i] === ";" || zbytek.startsWith("ON CONFLICT", i)));
    const telo = konec === -1 ? zbytek : zbytek.slice(0, konec);
    const radky = rozdel(telo, ",")
      .filter((t) => t.startsWith("(") && t.endsWith(")"))
      .map((t) => rozdel(t.slice(1, -1), ","));
    out.push({ sloupce, radky });
  }
  return out;
}

const literal = (s: string): string | null => (/^E?'((?:[^']|'')*)'$/.test(s) ? s.replace(/^E?'|'$/g, "").replace(/''/g, "'") : null);

function slugyPlatformy(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(CORE).filter((x) => x.endsWith(".sql"))) {
    for (const ins of inserty(readFileSync(join(CORE, f), "utf8"), "knowledge_items")) {
      const i = ins.sloupce.indexOf("source_slug");
      if (i === -1) continue;
      const iStatus = ins.sloupce.indexOf("status");
      for (const r of ins.radky) {
        const slug = literal(r[i] ?? "");
        const status = iStatus === -1 ? "active" : literal(r[iStatus] ?? "");
        if (slug && status === "active") out.add(slug);
      }
    }
  }
  return out;
}

type Otazka = { slug: string; language: string; profil: string; ocekavane: string[] };

function golden(): Otazka[] {
  const [ins] = inserty(readFileSync(GOLDEN, "utf8"), "rag_eval_golden");
  const idx = (c: string) => ins.sloupce.indexOf(c);
  return ins.radky.map((r) => {
    const pole = r[idx("expected_chunk_slugs")];
    const ocekavane = /^'\{\}'/.test(pole)
      ? []
      : [...(pole.match(/ARRAY\[([^\]]*)\]/)?.[1] ?? "").matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
    return {
      slug: literal(r[idx("slug")]) ?? "?",
      language: literal(r[idx("language")]) ?? "?",
      profil: literal(r[idx("context_profile_slug")]) ?? "?",
      ocekavane,
    };
  });
}

describe("platformní RAG golden set označuje jen platformní obsah", () => {
  const platforma = slugyPlatformy();
  const otazky = golden();

  test("fixture: parser vidí obsah platformy i golden set (jinak by brána mlčela)", () => {
    // Kontrolní vzorek: slug, o kterém víme, že ho seed/core zakládá.
    expect(platforma.has("aisha-platform-overview")).toBe(true);
    expect(platforma.size).toBeGreaterThan(40);
    expect(otazky.length).toBeGreaterThan(20);
    expect(otazky.every((o) => o.slug !== "?" && ["cs", "en"].includes(o.language))).toBe(true);
  });

  const jePlatformni = (label: string) => platforma.has(label.replace(/:\d+$/, ""));
  const nadPlatformou = (o: Otazka) => o.ocekavane.length > 0 && o.ocekavane.every(jePlatformni);

  test("⛔ platformní sada (plat-*) označuje jen aktivní knowledge_items ze seed/core", () => {
    const sada = otazky.filter((o) => o.slug.startsWith("plat-"));
    expect(sada.length, "platformní sada zmizela").toBeGreaterThan(0);
    const cizi = sada.flatMap((o) => o.ocekavane.filter((s) => !jePlatformni(s)).map((s) => `${o.slug} → ${s}`));
    expect(cizi, "platformní otázka míří na obsah, který seed/core nezakládá").toEqual([]);
    expect(sada.filter((o) => o.ocekavane.length === 0).map((o) => o.slug), "platformní otázka bez labelu").toEqual([]);
  });

  test("⛔ každý jazyk má ≥ 6 otázek označených VÝHRADNĚ platformním obsahem", () => {
    const pocet = (lang: string) => otazky.filter((o) => o.language === lang && nadPlatformou(o)).length;
    expect(pocet("cs"), "cs — výběr embedding modelu by na instanci bez demo KB neodrážel češtinu").toBeGreaterThanOrEqual(6);
    expect(pocet("en"), "en").toBeGreaterThanOrEqual(6);
  });

  test("aspoň jedna anglická otázka míří na obsah psaný česky (mezijazyčné vyhledávání)", () => {
    // Obsah tao-* / aisha-* osobnosti je v seedu česky; en otázka nad ním měří, zda embedding
    // model zvládá cs↔en — přesně vlastnost, kvůli které se v1 prostor volí multilingvní.
    const ceskyObsah = [...platforma].filter((s) => s.startsWith("tao-") || /^aisha-(empathy|frustration|no-|quality|never|warmth|core)/.test(s));
    const mezijazycne = otazky.filter((o) => o.language === "en" && o.ocekavane.some((s) => ceskyObsah.includes(s)));
    expect(mezijazycne.length).toBeGreaterThanOrEqual(1);
  });
});
