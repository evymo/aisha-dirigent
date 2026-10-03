/**
 * lastMonths(n, now) — které kalendářní měsíce plánovač každý tik přesynchronizuje.
 * Čistá funkce, ale rozhoduje o tom, CO se do source_period_stats vůbec dostane:
 * chyba o jeden měsíc by tiše vynechala právě ten, na který se správce dívá.
 * Měsíce se počítají v UTC z prvního dne, aby přelom měsíce v lokálním čase
 * (23:30 CEST 31. 8. = 21:30Z) nedal jiný výsledek než na serveru.
 */
import { describe, expect, it } from 'vitest';
import { lastMonths } from '../scheduler.js';

describe('lastMonths', () => {
  it('vrací aktuální měsíc a n-1 předchozích, nejnovější první, ve tvaru YYYY-MM', () => {
    expect(lastMonths(3, new Date(Date.UTC(2026, 8, 8)))).toEqual(['2026-09', '2026-08', '2026-07']);
  });
  it('přechází přes Nový rok bez zaokrouhlení na leden', () => {
    expect(lastMonths(3, new Date(Date.UTC(2026, 0, 15)))).toEqual(['2026-01', '2025-12', '2025-11']);
  });
  it('počítá v UTC — poslední večer měsíce v Evropě je ještě starý měsíc na serveru', () => {
    // 31. 8. 2026 23:30 Europe/Prague = 21:30Z téhož dne → stále srpen
    expect(lastMonths(1, new Date('2026-08-31T21:30:00Z'))).toEqual(['2026-08']);
  });
  it('n = 1 dává jen aktuální měsíc; n = 0 nic (žádný tichý default)', () => {
    expect(lastMonths(1, new Date(Date.UTC(2026, 8, 8)))).toEqual(['2026-09']);
    expect(lastMonths(0, new Date(Date.UTC(2026, 8, 8)))).toEqual([]);
  });
});
