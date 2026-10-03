/**
 * Normalizace volného štítku novinek: trim, malá písmena, mezery → pomlčky,
 * jen písmena/číslice/podtržítko/pomlčka, max 40 znaků. „Vajra Family" a
 * „vajra-family" tak jsou jeden filtr, ne dva.
 */
export function normalizujStitek(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40);
}
