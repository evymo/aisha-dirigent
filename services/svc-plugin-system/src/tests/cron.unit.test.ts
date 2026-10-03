import { describe, expect, it } from 'vitest';
import { NeplatnyCron, pristiBeh } from '../planovac/cron.js';

// Testy běží v UTC (vitest.config.ts: test.env.TZ), aby očekávané časy
// nezávisely na stroji, na kterém běží.
const utc = (s: string) => new Date(`${s}Z`);
const iso = (d: Date) => d.toISOString().replace('.000Z', '');

describe('pristiBeh (cron o pěti polích, pásmo procesu)', () => {
  it('*/5: příští násobek pěti PŘÍSNĚ po', () => {
    expect(iso(pristiBeh('*/5 * * * *', utc('2026-09-16T20:47:30')))).toBe('2026-09-16T20:50:00');
    expect(iso(pristiBeh('*/5 * * * *', utc('2026-09-16T20:50:00')))).toBe('2026-09-16T20:55:00');
  });

  it('denní 03:00 přes půlnoc a přes konec měsíce', () => {
    expect(iso(pristiBeh('0 3 * * *', utc('2026-09-16T20:47:00')))).toBe('2026-09-17T03:00:00');
    expect(iso(pristiBeh('0 3 * * *', utc('2026-09-30T04:00:00')))).toBe('2026-10-01T03:00:00');
  });

  it('rozsah a seznam: 20. minuta v 8–10 a 14 hod', () => {
    expect(iso(pristiBeh('20 8-10,14 * * *', utc('2026-09-16T10:21:00')))).toBe('2026-09-16T14:20:00');
  });

  it('den v týdnu: pondělí (1) i neděle jako 7', () => {
    expect(iso(pristiBeh('0 6 * * 1', utc('2026-09-16T00:00:00')))).toBe('2026-09-21T06:00:00'); // st → po
    expect(iso(pristiBeh('0 6 * * 7', utc('2026-09-16T00:00:00')))).toBe('2026-09-20T06:00:00'); // → ne
  });

  it('den v měsíci × den v týdnu: omezené oba = stačí jeden (Vixie)', () => {
    // 1. v měsíci NEBO pondělí; po 16. 9. (st) je nejdřív pondělí 21. 9.
    expect(iso(pristiBeh('0 0 1 * 1', utc('2026-09-16T12:00:00')))).toBe('2026-09-21T00:00:00');
  });

  it('29. února se najde i přes neexistující roky', () => {
    expect(iso(pristiBeh('0 0 29 2 *', utc('2026-03-01T00:00:00')))).toBe('2028-02-29T00:00:00');
  });

  it.each(['@daily', '0 3 * * MON', '0 3 * *', '61 * * * *', '* * * * */0', '5-2 * * * *'])(
    '⛔ neplatný cron „%s" se ODMÍTNE, nehádá se',
    (cron) => {
      expect(() => pristiBeh(cron, utc('2026-09-16T00:00:00'))).toThrow(NeplatnyCron);
    },
  );
});
