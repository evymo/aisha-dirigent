/**
 * Brána: balíčky, které skripty cold-startu importují SESTAVENÉ, cold-start sestaví
 * dřív, než je první skript potřebuje — a doktor měří, že to půjde.
 *
 * ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku, krok 4): knock-provision → knock-roster.mjs
 * importuje packages/knock-protocol/dist; dist je gitignorovaný, cold-start ho
 * nesestavoval, doktor nehlídal → v konvergenčním stromu dveře padly.
 *
 * Měří se:
 *   1. odvození z importů neosiřelo (kontrolní vzorek: knock-protocol);
 *   2. krok 0b (`--sestav`) stojí v cold-startu PŘED krokem 1 i před prvním
 *      voláním skriptu, který dist potřebuje (knock-provision);
 *   3. doktor volá `--zkontroluj` a výsledek promítá do verdiktu.
 * Chování knihovny měří scripts/lib/balicky-pro-skripty.test.mjs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { balickyProSkripty, popisImportuJmenem, prohledejSkripty } from '../../../scripts/lib/balicky-pro-skripty.mjs';

const ROOT = process.cwd();
const CS = readFileSync(join(ROOT, 'scripts/aisha-cold-start.sh'), 'utf8');

describe('balíčky pro skripty jsou sestavené dřív, než je skripty potřebují', () => {
  it('odvození z importů vidí knock-protocol (měřidlo neosiřelo)', () => {
    expect(balickyProSkripty(ROOT)).toContain('packages/knock-protocol');
  });

  // Nedůvěřivé čtení 2026-10-03, nález 5: sken četl jen scripts/ a scripts/lib/
  // a import balíčku JMÉNEM počítal jako „nic“ — obě hranice byly tiché.
  it('sken čte celé scripts/ a žádný skript neimportuje balíček workspace jménem', () => {
    const sken = prohledejSkripty(ROOT);
    expect(sken.prohledano, 'sken nevidí podadresáře scripts/ (samotné scripts/ + lib/ je pod 400 souborů)').toBeGreaterThan(400);
    expect(
      sken.jmenem.map(popisImportuJmenem),
      'import jménem odvození nevidí → cold-start by balíček nesestavil; krok 0b i doktor na něm skončí',
    ).toEqual([]);
  });

  it('krok 0b sestavuje před krokem 1 a před prvním knock-provision', () => {
    const sestav = CS.indexOf('balicky-pro-skripty.mjs" --sestav');
    expect(sestav, 'cold-start balíčky pro skripty nesestavuje').toBeGreaterThan(-1);
    expect(sestav, 'sestavení musí předejít kroku 1').toBeLessThan(CS.indexOf('step "1. SAFETY CHECK'));
    const prvniKnock = CS.search(/\bnode scripts\/knock-provision\.mjs/);
    expect(prvniKnock, 'knock-provision v cold-startu nenalezen — vzorek osiřel').toBeGreaterThan(-1);
    expect(sestav).toBeLessThan(prvniKnock);
  });

  it('doktor měří sestavitelnost a promítá ji do verdiktu', () => {
    const doktor = readFileSync(join(ROOT, 'scripts/cold-start-doctor.sh'), 'utf8');
    expect(doktor).toMatch(/balicky-pro-skripty\.mjs" --zkontroluj/);
    const usek = doktor.slice(doktor.indexOf('balicky-pro-skripty.mjs" --zkontroluj'));
    expect(usek.slice(0, 800), 'nález musí být fail, ne jen výpis').toMatch(/\bfail "Balíčky pro skripty nepůjde sestavit/);
  });
});
