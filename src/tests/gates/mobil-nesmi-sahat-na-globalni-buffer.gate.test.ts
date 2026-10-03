/**
 * BRÁNA: v mobilní aplikaci se nesmí sáhnout na GLOBÁLNÍ `Buffer`.
 *
 * ⛔ NAHLÁŠENO Z PROVOZU 2026-09-01. Řidiči nešlo zaklepat ANI Z JEDNÉ
 * aplikace — obrazovka „Zaklepat" hlásila:
 *
 *     Neodesláno
 *     Property 'Buffer' doesn't exist
 *
 * `Buffer` je globál Node.js; v React Native (Hermes) NEEXISTUJE. Soubor
 * `knock-native.ts` si knihovní Buffer správně importoval
 * (`@craftzdog/react-native-buffer`), ale na TŘECH místech pak použil ten
 * globální — HMAC, scrypt a odeslání UDP paketu. Tedy přesně na cestě
 * zaťukání.
 *
 * ⭐ A tohle je to podstatné: dva řádky NAD tím stál komentář, který přesně
 * před touhle záměnou varoval („Buffer OD KNIHOVNY, ne globální … kdyby to
 * někdo ‚opravil‘ castem, zůstala by tu záměna dvou různých Bufferů skrytá").
 * Komentář to nezachytil. Popis záměru není záruka záměru — držet ho musí
 * MĚŘIDLO.
 *
 * Následek byl provozní, ne kosmetický: dveře na edge byly zavřené, takže
 * nefunkční zaťukání = řidič se do aplikace nedostane vůbec.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const KOREN = join(__dirname, '..', '..', '..', 'mobile-app', 'src');

/** Univerzum se HLEDÁ: každý zdroj mobilní aplikace, ne vyjmenovaný seznam. */
function zdroje(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) zdroje(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.(test|spec)\./.test(n)) out.push(p);
  }
  return out;
}

describe('brána: mobil nesmí sáhnout na globální Buffer', () => {
  const soubory = zdroje(KOREN);

  it('sonda má co měřit — zdroje se našly', () => {
    expect(soubory.length).toBeGreaterThan(20);
  });

  it('nikde se nevolá globální Buffer.from / .concat / .alloc', () => {
    const viníci: string[] = [];
    for (const f of soubory) {
      const kod = readFileSync(f, 'utf-8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // komentáře nesou tatáž slova
        .join('\n');
      // `RNBuffer.from` je v pořádku; hledá se `Buffer.` bez předpony.
      const m = kod.match(/(?<![A-Za-z0-9_])Buffer\.(from|concat|alloc)/g);
      if (m) viníci.push(`${f.replace(KOREN, 'mobile-app/src')}: ${m.length}×`);
    }
    expect(viníci).toEqual([]);
  });
});
