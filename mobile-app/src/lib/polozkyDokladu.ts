/**
 * POLOŽKY DOKLADU — co se vlastně veze, pro oči člověka u rampy.
 *
 * Registr drží řádky dokladu v témže bráněném tvaru jako pole dokladu:
 * `{ line_index, status, issues, method, fields: { item_name: {raw, value,
 * gate, span}, quantity: {...}, unit: {...}, item_code: {...} } }`.
 * Naměřeno na produkci 2026-09-01: 23 584 dodáků ze 43 809 položky má
 * a nesou právě tahle čtyři pole (50 336 řádků).
 *
 * ⛔ NEPOČÍTÁ SE TU NIC. Množství se nesčítá, nepřepočítává ani nedoplňuje —
 * je to údaj z dokladu a povrch ho jen ukazuje. Součet by byl NOVÉ TVRZENÍ
 * o dodávce a to na obrazovce nevzniká; kdyby ho někdo potřeboval, patří
 * k dokladu, ne k jeho zobrazení.
 *
 * ⛔ PRÁZDNÝ ŘÁDEK SE NEKRESLÍ (JAZYK-03). Doklad bez rozpoznaného názvu
 * položky je vada rozpoznání, kterou řeší review fronta — na obrazovce
 * řidiče by z ní byl prázdný proužek, který nic neříká.
 */

/** Jedno pole řádku tak, jak ho registr drží. */
interface PoleRadku {
  value?: unknown;
  raw?: unknown;
  gate?: unknown;
}

/** Řádek dokladu z `li_source_registry.line_items`. */
export interface RadekDokladu {
  line_index?: unknown;
  status?: unknown;
  fields?: Record<string, PoleRadku | undefined> | null;
}

/** Řádek připravený ke kreslení — už jen text. */
export interface PolozkaKZobrazeni {
  nazev: string;
  mnozstvi: string;
  /** `true` = řádek NEPROŠEL branami a čeká na člověka; povrch to má přiznat. */
  cekaNaKontrolu: boolean;
}

function text(pole: PoleRadku | undefined): string {
  const v = pole?.value ?? pole?.raw;
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
}

/**
 * Stavy řádku, které PROŠLY: brány ingestu (`AUTO_PASS`) nebo člověk
 * (`HUMAN_CONFIRMED`); `PASS` zůstává kvůli starším datům.
 *
 * ⛔ NAMĚŘENO 2026-09-30 (tablet, Řidič 15b): pravidlo bylo „cokoli jiného než
 *    PASS čeká na kontrolu“ — jenže ingest `PASS` nepíše vůbec (orchestrator:
 *    lines_review = status != AUTO_PASS). Každá položka tak nesla ⚠ a „Čeká na
 *    kontrolu“, i u přebírajícího na podpisové obrazovce. Neznámý nebo chybějící
 *    stav se jako „čeká“ nehlásí — tvrdit to bez podkladu by bylo stejně nepravdivé.
 */
const PROSLE = new Set(["AUTO_PASS", "HUMAN_CONFIRMED", "PASS"]);
const CEKA = new Set(["NEEDS_REVIEW", "REVIEW", "REJECTED", "PENDING"]);

function cekaNaKontrolu(stav: unknown): boolean {
  if (typeof stav !== "string") return false;
  const s = stav.trim().toUpperCase();
  return !PROSLE.has(s) && CEKA.has(s);
}

/**
 * Řádky registru → řádky k zobrazení.
 *
 * ⭐ MNOŽSTVÍ A JEDNOTKA JDOU DOHROMADY. Dvě sousední kolonky („12,5" a „t")
 * se čtou hůř než jedna („12,5 t") a u rampy se čte rychle. Jednotka bez
 * množství se nekreslí — samotné „t" není údaj.
 */
export function polozkyKZobrazeni(radky: readonly RadekDokladu[] | null | undefined): PolozkaKZobrazeni[] {
  if (!Array.isArray(radky)) return [];
  const out: PolozkaKZobrazeni[] = [];
  for (const r of radky) {
    const f = r?.fields ?? undefined;
    const nazev = text(f?.item_name);
    if (!nazev) continue; // JAZYK-03
    const mnozstvi = text(f?.quantity);
    const jednotka = text(f?.unit);
    out.push({
      nazev,
      mnozstvi: mnozstvi ? [mnozstvi, jednotka].filter(Boolean).join(" ") : "",
      cekaNaKontrolu: cekaNaKontrolu(r?.status),
    });
  }
  return out;
}

/** Cíl zastávky pro kartu TEĎ — co se tam skládá, jedním řádkem. */
export interface CilZastavky {
  /** Zvýrazněná část — množství první položky, jinak její název. */
  hlavni: string;
  /** Doplněk za tečkou — název první položky a kolik dalších. */
  doplnek: string | null;
  /** Kolik položek dál na dokladu je (bez první). */
  dalsich: number;
}

/**
 * Položky → cíl zastávky („24 t · štěrk 0/32 · +2").
 *
 * ⛔ STÁLE SE NIC NESČÍTÁ. Předloha má „SLOŽIT 24 T" jako součet dodávky; součet
 *    by byl nové tvrzení (viz hlavička souboru). Karta proto ukáže PRVNÍ řádek
 *    dokladu tak, jak je, a přizná, kolik dalších jich je — řidič ví, že má
 *    otevřít detail, a nikdo mu nepodstrčí číslo, které na papíře není.
 *
 * ⛔ Řádek čekající na kontrolu se neskrývá: je to údaj z dokladu, jen ještě
 *    neprošel branami. Přiznání patří do detailu, kde je vidět celá tabulka.
 */
export function cilZPolozek(polozky: readonly PolozkaKZobrazeni[]): CilZastavky | null {
  const [prvni, ...dalsi] = polozky;
  if (!prvni) return null;
  return prvni.mnozstvi
    ? { hlavni: prvni.mnozstvi, doplnek: prvni.nazev, dalsich: dalsi.length }
    : { hlavni: prvni.nazev, doplnek: null, dalsich: dalsi.length };
}

/**
 * Řádek položky tak, jak ho vydá server S KROKEM (`get_workflow_step_polozky`):
 * hodnoty už bez provenance, tablet jen deklarované klíče; `stav_radku` = stav
 * řádku v registru (brány), pokud ho server poslal.
 */
export type RadekKroku = Record<string, unknown>;

/**
 * Řádky z kroku → řádky k zobrazení. Táž pravidla jako `polozkyKZobrazeni`
 * (název povinný, množství s jednotkou dohromady, „čeká na kontrolu“ podle stavu) —
 * jen vstup přichází s krokem, ne z registru.
 */
export function polozkyZKroku(radky: readonly RadekKroku[] | null | undefined): PolozkaKZobrazeni[] {
  if (!Array.isArray(radky)) return [];
  return polozkyKZobrazeni(
    radky
      .filter((r): r is RadekKroku => r !== null && typeof r === "object")
      .map((r) => ({
        status: typeof r.stav_radku === "string" ? r.stav_radku : undefined,
        fields: Object.fromEntries(
          Object.entries(r)
            .filter(([k]) => k !== "stav_radku")
            .map(([k, v]) => [k, { value: v }]),
        ),
      })),
  );
}
