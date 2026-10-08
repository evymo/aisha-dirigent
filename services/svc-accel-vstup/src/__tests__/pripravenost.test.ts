import { describe, expect, it } from 'vitest';
import { Pripravenost, type Sondy } from '../pripravenost.js';
import type { Engine } from '../tabulka.js';
import { uzel } from './fixtura.js';

const engine = (upravy: Partial<Engine> = {}): Engine => ({ ...uzel().enginy['embed-1'], id: 'embed-1', ...upravy });

/** Řízené sondy: zdraví a zahřátí podle stavu testu, čas ručně. */
function sondy() {
  const s = {
    zdravy: false,
    identita: { format: 'safetensors', sha256: 'a'.repeat(64), revize: 'b'.repeat(40) },
    zahrati: null as null | { resolve: () => void; reject: (e: Error) => void },
    cas: 0,
    zahratiVolano: 0,
  };
  const api: Sondy = {
    zdravi: async () => s.zdravy,
    zahrej: () =>
      new Promise((resolve, reject) => {
        s.zahratiVolano++;
        s.zahrati = { resolve: () => resolve(s.identita), reject };
      }),
    ted: () => s.cas,
  };
  return { s, api };
}
const pockej = () => new Promise((r) => setImmediate(r));

describe('připravenost lane: health + zahřátí, rozhodnutí hned (R5a)', () => {
  it('čtyři stavy R5a: nedostupná, startuje, health 200 bez zahřátí = startuje, po zahřátí propustí', async () => {
    const { s, api } = sondy();
    const p = new Pripravenost(api);
    const e = engine();
    expect(p.rozhodni(e), 'před první sondou').toBe('LANE_STARTUJE');
    await p.krok([e]);
    expect(p.stav('embed-1')).toBe('STARTUJE');
    expect(p.rozhodni(e)).toBe('LANE_STARTUJE');

    s.zdravy = true;
    await p.krok([e]);
    expect(p.stav('embed-1'), '/health 200 ještě není připraveno (MJ23)').toBe('ZAHRIVA');
    expect(p.rozhodni(e)).toBe('LANE_STARTUJE');
    expect(s.zahratiVolano).toBe(1);
    await p.krok([e]);
    expect(s.zahratiVolano, 'zahřátí se nespouští dvakrát').toBe(1);

    s.zahrati!.resolve();
    await pockej();
    expect(p.stav('embed-1')).toBe('PRIPRAVEN');
    expect(p.rozhodni(e), 'kotva: zahřátá lane propustí').toBeNull();
  });

  it('vypnutý engine = LANE_NEDOSTUPNA, ne LANE_STARTUJE (MN12)', async () => {
    const { api } = sondy();
    const p = new Pripravenost(api);
    const e = engine({ zapnuto: false });
    await p.krok([e]);
    expect(p.stav('embed-1')).toBe('VYPNUT');
    expect(p.rozhodni(e)).toBe('LANE_NEDOSTUPNA');
  });

  it('start přes start_mez_s = NEZDRAVY a LANE_NEDOSTUPNA', async () => {
    const { s, api } = sondy();
    const p = new Pripravenost(api);
    const e = engine({ start_mez_s: 300 });
    await p.krok([e]);
    s.cas = 299_000;
    await p.krok([e]);
    expect(p.rozhodni(e)).toBe('LANE_STARTUJE');
    s.cas = 301_000;
    await p.krok([e]);
    expect(p.stav('embed-1')).toBe('NEZDRAVY');
    expect(p.rozhodni(e)).toBe('LANE_NEDOSTUPNA');
  });

  it('připravená lane, která přestane odpovídat = NEZDRAVY; po návratu se ZNOVU zahřeje', async () => {
    const { s, api } = sondy();
    const p = new Pripravenost(api);
    const e = engine();
    s.zdravy = true;
    await p.krok([e]);
    s.zahrati!.resolve();
    await pockej();
    expect(p.stav('embed-1')).toBe('PRIPRAVEN');

    s.zdravy = false;
    await p.krok([e]);
    expect(p.rozhodni(e)).toBe('LANE_NEDOSTUPNA');

    s.zdravy = true;
    await p.krok([e]);
    expect(p.stav('embed-1'), 'po výpadku nejdřív zahřátí').toBe('ZAHRIVA');
    expect(s.zahratiVolano).toBe(2);
  });

  it('jiná identita vah po zahřátí = ROZPOR, nikdy připraveno (EM2, R5c)', async () => {
    const { s, api } = sondy();
    const hlaseni: string[] = [];
    const p = new Pripravenost(api, (u) => hlaseni.push(u));
    const e = engine();
    s.zdravy = true;
    s.identita = { ...s.identita, sha256: 'c'.repeat(64) };
    await p.krok([e]);
    s.zahrati!.resolve();
    await pockej();
    expect(p.stav('embed-1')).toBe('ROZPOR');
    expect(p.rozhodni(e)).toBe('LANE_NEDOSTUPNA');
    expect(hlaseni).toContain('rozpor_identity');
  });

  it('selhané zahřátí vrací do STARTUJE (zkusí znovu), ne do PRIPRAVEN', async () => {
    const { s, api } = sondy();
    const p = new Pripravenost(api);
    const e = engine();
    s.zdravy = true;
    await p.krok([e]);
    s.zahrati!.reject(new Error('timeout'));
    await pockej();
    expect(p.stav('embed-1')).toBe('STARTUJE');
    expect(p.rozhodni(e)).toBe('LANE_STARTUJE');
  });
});
