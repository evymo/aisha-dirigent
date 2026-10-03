import { describe, expect, it } from 'vitest';
import { jeTrvalaPricina, verdiktBehu, ZdrojNeniAktivni } from '../clients/li-driver.js';

describe('verdikt běhu: karanténa NENÍ selhání', () => {
  // ⛔ PŘESNĚ TENHLE STAV BYL V PROVOZU 2026-09-02:
  //     kbItems 3862 · karanténa 3 · total_syncs 1435 · failures 1435
  //     last_success_at = NULL
  // Tři balíčky ze 3.–4. 8. čekaly na rozhodnutí člověka a každý běh se kvůli
  // nim hlásil jako selhaný.
  it('běh, kde jediné odložené balíčky jsou v karanténě, je ÚSPĚŠNÝ', () => {
    const v = verdiktBehu({ errors: 0, karantena: ['2026-08-03T213210', '2026-08-04T111938'] });
    expect(v.ok).toBe(true);
    expect(v.chyba).toBeUndefined();
  });

  it('skutečná chyba běh POŘÁD shodí — jinak bychom si jen zhasli kontrolku', () => {
    const v = verdiktBehu({ errors: 1, karantena: [] });
    expect(v.ok).toBe(false);
    expect(v.chyba).toBe('one or more bundles failed');
  });

  it('chyba i karanténa současně: rozhoduje chyba', () => {
    expect(verdiktBehu({ errors: 2, karantena: ['a'] }).ok).toBe(false);
  });

  it('čistý běh je úspěšný', () => {
    expect(verdiktBehu({ errors: 0, karantena: [] })).toEqual({ ok: true });
  });
});

describe('trvalá příčina se pozná TYPEM i příznakem', () => {
  it('neaktivní zdroj = trvalá (letí bez obalu)', () => {
    expect(jeTrvalaPricina(new ZdrojNeniAktivni('pohlceny-zdroj', 'inactive'))).toBe(true);
  });

  it('zabalená s příznakem = taky trvalá', () => {
    expect(jeTrvalaPricina({ trvalaPricina: true })).toBe(true);
  });

  // Kdyby se kontrolovala jen jedna cesta, ta druhá by se tiše překlopila
  // v „přechodnou" a fronta by stála na neurčito.
  it('přechodná porucha trvalá NENÍ — kurzor se na ní drží', () => {
    expect(jeTrvalaPricina(new Error('ECONNRESET'))).toBe(false);
    expect(jeTrvalaPricina(undefined)).toBe(false);
    expect(jeTrvalaPricina({ trvalaPricina: false })).toBe(false);
  });
});
