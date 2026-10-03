/**
 * Datumová aritmetika výběru dne — BEZ Reactu a bez závislostí na zařízení.
 *
 * Stojí to vedle komponenty ze stejného důvodu jako `arrange` vedle rendereru:
 * pravidlo se dá změřit testem, aniž se rozjede půlka aplikace. (Doslova: první
 * verze měla tohle uvnitř `DayPicker.tsx`, takže si test přitáhl `@/hooks` →
 * auth → expo-linking a spadl na schématu URL, ne na datu.)
 */

/**
 * YYYY-MM-DD z LOKÁLNÍCH složek data.
 *
 * ⚠️ ŽÁDNÉ `toISOString()`. To je UTC, takže v našem pásmu by večer vrátilo
 * NÁSLEDUJÍCÍ den — uživatel klepne na 3. a dostane data ze 4., bez jediné
 * chyby a bez šance poznat proč. Datum je tady kalendářní údaj, ne okamžik.
 */
export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Pondělí = 0. `getDay()` má neděli 0, což by mřížku posunulo o den. */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/**
 * Dny měsíce zarovnané do týdnů od pondělí; `null` = prázdné políčko před
 * prvním / za posledním dnem. Plochý seznam — mřížku dělá flex-wrap.
 */
export function monthCells(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array(mondayIndex(first)).fill(null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Co se z vybraného dne pošle blokům.
 *
 * `status: 'any'` je součástí VÝBĚRU DNE, ne kosmetika: výchozí filtr fronty je
 * 'pending', jenže co bylo, to je hotové — bez toho by každý minulý den vrátil
 * prázdno, které vypadá jako „ten den se nic nevezlo".
 *
 * Bez vybraného dne se NEPOSÍLÁ NIC. Prázdné okno by přebilo konfiguraci bloku
 * a řidičova páska by přišla o svoje „dnešek a okolí".
 */
export function dayParams(day: string | null): Record<string, unknown> | undefined {
  if (!day) return undefined;
  return { date_from: day, date_to: day, status: "any" };
}
