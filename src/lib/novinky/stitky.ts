/**
 * Normalizace volného štítku novinek: trim, malá písmena, mezery → pomlčky,
 * jen písmena/číslice/podtržítko/pomlčka, max 40 znaků. „Vajra Family" a
 * „vajra-family" tak jsou jeden filtr, ne dva.
 */
export function normalizujStitek(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40);
}

/** Jmenný prostor překladů názvů štítků (klíč = hodnota štítku). */
export const NAMESPACE_STITKU = "news-tags";

/** `wisdom-quotes` → „Wisdom quotes“; prázdná hodnota zůstane prázdná. */
export function citelnyStitek(stitek: string): string {
  const text = stitek.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : stitek;
}

/**
 * Čitelný název štítku — opak normalizujStitek pro zobrazení. Štítek zůstává
 * v datech syrovou hodnotou (podle ní se filtruje), návštěvník webu má ale
 * vidět „People“, ne `people (9)` (zpětná vazba správkyně webu, 2026-09-30).
 * Pořadí: překlad v jmenném prostoru `news-tags` (klíč = hodnota štítku, jazyk
 * návštěvníka) → čitelná podoba hodnoty. Překlad spravuje autor v administraci.
 *
 * @param stitek - syrová hodnota štítku
 * @param preklady - mapa klíč → překlad z `NAMESPACE_STITKU`
 */
export function popisekStitku(stitek: string, preklady: Readonly<Record<string, string | undefined>>): string {
  return preklady[stitek]?.trim() || citelnyStitek(stitek);
}
