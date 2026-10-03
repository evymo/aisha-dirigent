/**
 * Hlídač čísel — odpověď modelu smí nést jen čísla a data, která jsou ve faktech.
 *
 * Kontext (majitel 2026-09-29, fáze 4 plánu „AI na CPU"): fakta počítá DB
 * (`answer_verified_facts` pod oprávněním uživatele), model je jen JAZYK. Prosba
 * v promptu („nepiš číslo, které ve faktech není") nic nevynucuje — malý model na
 * CPU ji poruší a uživatel by viděl vymyšlenou částku jako fakt. Proto server
 * před vrácením odpovědi porovná každé číslo a datum s fakty; cizí hodnota =
 * odpověď modelu se zahodí a zůstane deterministická odpověď z DB.
 *
 * Porovnávají se HODNOTY, ne zápisy: „194 360 Kč", „194.360", „194360" i
 * „11. 11. 2024" × `2024-11-11` jsou totéž. Nejednoznačný zápis („194.360" =
 * tisíce po česku, nebo 194,36 po anglicku) projde, když je ve faktech kterékoli
 * čtení — hodnota i tak musí pocházet z faktů, přísnost to neoslabuje.
 *
 * Mezera (vědomá): čísla slovy („dvě stě tisíc") hlídač nevidí. Prompt kanálu
 * je zakazuje; zákaz slovních číslovek jako schopnost je samostatný krok.
 *
 * @module
 */

/** Datum v odpovědi: `11. 11. 2024`, `11.11.2024`, `2024-11-11` → `2024-11-11`. */
const DATUM_CZ = /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g;
const DATUM_ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
/**
 * Číslo: skupiny tisíců oddělené mezerou (i nezlomitelnou), tečkou nebo čárkou,
 * volitelně desetinná část. Mezera jako oddělovač jen před přesně 3 číslicemi,
 * aby „1 smlouva 686 dní" nesplynulo v 1686.
 */
const CISLO = /\d{1,3}(?:[ \u00a0\u202f.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

const iso = (r: string, m: string, d: string) => `${r}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

/** Vytáhne data a vrátí text, ve kterém jsou data vymazaná (aby se nepočítala i jako čísla). */
function vytahniData(text: string): { data: string[]; zbytek: string } {
  const data: string[] = [];
  let zbytek = text.replace(DATUM_ISO, (_c, r: string, m: string, d: string) => {
    data.push(iso(r, m, d));
    return " ";
  });
  zbytek = zbytek.replace(DATUM_CZ, (_c, d: string, m: string, r: string) => {
    data.push(iso(r, m, d));
    return " ";
  });
  return { data, zbytek };
}

/** Všechna možná čtení zápisu čísla (oddělovač tisíců × desetinná čárka/tečka). */
function cteniCisla(zapis: string): number[] {
  const bezMezer = zapis.replace(/[ \u00a0\u202f]/g, "");
  const cteni = new Set<number>();
  // čárka i tečka jako oddělovač tisíců
  cteni.add(Number(bezMezer.replace(/[.,]/g, "")));
  // poslední čárka/tečka jako desetinná, ostatní jako tisíce
  const posledni = Math.max(bezMezer.lastIndexOf(","), bezMezer.lastIndexOf("."));
  if (posledni >= 0) {
    const cela = bezMezer.slice(0, posledni).replace(/[.,]/g, "");
    cteni.add(Number(`${cela}.${bezMezer.slice(posledni + 1)}`));
  }
  return [...cteni].filter((n) => Number.isFinite(n));
}

export interface HodnotyTextu {
  cisla: { zapis: string; cteni: number[] }[];
  data: string[];
}

/** Rozloží text na zápisy čísel (se všemi čteními) a data v ISO tvaru. */
export function hodnotyTextu(text: string): HodnotyTextu {
  const { data, zbytek } = vytahniData(text);
  const cisla = (zbytek.match(CISLO) ?? []).map((zapis) => ({ zapis, cteni: cteniCisla(zapis) }));
  return { cisla, data };
}

/** Povolené hodnoty z faktů: každé číslo v JSON a každé číslo/datum v textech. */
export function povoleneHodnoty(...zdroje: unknown[]): { cisla: Set<number>; data: Set<string> } {
  const cisla = new Set<number>();
  const data = new Set<string>();
  const projdi = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === "number") {
      if (Number.isFinite(v)) cisla.add(Math.abs(v));
      return;
    }
    if (typeof v === "string") {
      const h = hodnotyTextu(v);
      for (const d of h.data) data.add(d);
      for (const c of h.cisla) for (const n of c.cteni) cisla.add(n);
      return;
    }
    if (Array.isArray(v)) return v.forEach(projdi);
    if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) projdi(x);
  };
  zdroje.forEach(projdi);
  // Datum ve faktech povoluje i své složky (model smí napsat „od listopadu 2024").
  for (const d of data) for (const s of d.split("-")) cisla.add(Number(s));
  return { cisla, data };
}

export interface VerdiktHlidace {
  /** true = odpověď nese jen hodnoty z faktů. */
  ok: boolean;
  /** Zápisy čísel a data, která ve faktech nejsou (pro provenienci a log — bez textu odpovědi). */
  cizi: string[];
}

/**
 * Porovná odpověď modelu s fakty. `zdroje` = obálka faktů (data, answer, rows…)
 * a otázka uživatele (číslo, které uživatel sám napsal, smí model zopakovat).
 */
export function hlidejCisla(odpoved: string, ...zdroje: unknown[]): VerdiktHlidace {
  const povolene = povoleneHodnoty(...zdroje);
  const h = hodnotyTextu(odpoved);
  const cizi: string[] = [];
  for (const d of h.data) if (!povolene.data.has(d)) cizi.push(d);
  for (const c of h.cisla) if (!c.cteni.some((n) => povolene.cisla.has(n))) cizi.push(c.zapis);
  return { ok: cizi.length === 0, cizi };
}
