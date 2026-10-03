import { describe, expect, it } from 'vitest';
import { num } from '../config.js';

/**
 * Prázdná hodnota v prostředí znamená „nenastaveno", ne „nula".
 *
 * ⛔ NAMĚŘENO 2026-09-02 na `SPA_OTP_SKEW`. `Number('')` NENÍ `NaN`, je to `0` —
 * a nula projde stráží `Number.isFinite` jako platná hodnota, takže se výchozí
 * `1` nikdy nepoužije a okno OTP se tiše zúží na jediný krok.
 *
 * ⚠️ Vada se projeví JEN u klíče deklarovaného s PRÁZDNOU hodnotou. Nenastavená
 * proměnná se chová správně (`Number(undefined)` je `NaN`), takže se to při
 * čtení kódu snadno přehlédne — a prázdně deklarovaný klíč je v `.env` běžný.
 *
 * Vrátný přitom mlčí: zúžené okno OTP se navenek neliší od zavřených dveří.
 */
describe('num(): prázdno je „nenastaveno", ne nula', () => {
  it('⛔ prázdný řetězec vrací VÝCHOZÍ hodnotu, ne 0', () => {
    expect(num('', 1)).toBe(1);
  });

  it('⛔ samé mezery jsou taky prázdno', () => {
    expect(num('   ', 1)).toBe(1);
  });

  it('nenastavená proměnná vrací výchozí hodnotu', () => {
    expect(num(undefined, 7)).toBe(7);
  });

  /**
   * ⭐ HRANICE, NA KTERÉ SE POZNÁ SPRÁVNÁ STRÁŽ. „Prázdno = nenastaveno" nesmí
   * sklouznout k „nula = nenastaveno": výslovnou nulu napsal člověk a je to
   * úmysl, který se přebít nesmí. Bez tohohle testu by prošla i stráž
   * `if (!n) return d`, která úmysl tiše zahodí.
   */
  it('⭐ výslovná nula ZŮSTÁVÁ nulou', () => {
    expect(num('0', 5)).toBe(0);
  });

  it('nečíselná hodnota vrací výchozí', () => {
    expect(num('abc', 3)).toBe(3);
  });

  it('platné číslo projde beze změny', () => {
    expect(num('42', 3)).toBe(42);
  });
});
