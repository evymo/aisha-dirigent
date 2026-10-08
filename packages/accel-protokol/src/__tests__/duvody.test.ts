import { describe, expect, it } from 'vitest';
import { DUVODY_ODMITNUTI, HLAVICKY, SEZNAM_DUVODU, TRIDY, jeDuvod, odmitnuti } from '../index.js';

describe('slovník důvodů odmítnutí lane', () => {
  it('je uzavřený: každý kód má HTTP stav 4xx/5xx, žádný jiný tvar', () => {
    expect(SEZNAM_DUVODU.length).toBeGreaterThan(10);
    for (const k of SEZNAM_DUVODU) {
      expect(k, 'kód je VELKÝMI_PÍSMENY').toMatch(/^[A-Z][A-Z_]+$/);
      expect(DUVODY_ODMITNUTI[k] >= 400 && DUVODY_ODMITNUTI[k] < 600, k).toBe(true);
    }
    expect(Object.isFrozen(DUVODY_ODMITNUTI)).toBe(true);
  });

  it('R5a: lane startuje i nedostupná jsou 503 — fork je od sebe rozezná kódem, ne stavem', () => {
    expect(DUVODY_ODMITNUTI.LANE_STARTUJE).toBe(503);
    expect(DUVODY_ODMITNUTI.LANE_NEDOSTUPNA).toBe(503);
  });

  it('odmítnutí nese kód jako PRVNÍ pole; neznámý kód je výjimka (MJ24), ne 500', () => {
    const o = odmitnuti('KVOTA_PREKROCENA', 'kvóta dotazů vyčerpaná', { kvota: 'soubeh.dotaz' });
    expect(o.status).toBe(429);
    expect(Object.keys(o.telo)[0]).toBe('duvod');
    expect(o.telo).toEqual({ duvod: 'KVOTA_PREKROCENA', error: 'kvóta dotazů vyčerpaná', kvota: 'soubeh.dotaz' });
    // @ts-expect-error — kód mimo slovník
    expect(() => odmitnuti('NECO_JINEHO', 'x')).toThrow(/není ve slovníku/);
    expect(jeDuvod('LANE_STARTUJE')).toBe(true);
    expect(jeDuvod('toString')).toBe(false);
  });

  it('hlavičky jsou malými písmeny (Node je tak vrací) a třídy jsou jen dvě', () => {
    for (const h of Object.values(HLAVICKY)) expect(h).toBe(h.toLowerCase());
    expect([...TRIDY]).toEqual(['dotaz', 'davka']);
  });
});
