import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vlastní Expo modul má dvě půlky: JS rozhraní a nativní implementaci. Brána
 * měří, že OBĚ jsou SLEDOVANÉ GITEM — ne že leží na disku.
 *
 * ⛔ NAMĚŘENO 2026-09-22. `mobile-app/.gitignore` nesl vzor `android/` bez
 * lomítka na začátku, takže platil na adresář toho jména v JAKÉKOLI hloubce.
 * Modul `rizena-konfigurace` se tím commitnul jen svou JS půlkou. Nic by
 * nespadlo: appka by se postavila, `requireOptionalNativeModule` by vrátil
 * null a konfigurace od správce zařízení by prostě tiše neexistovala — tedy
 * hotová funkce, která na nasazeném zařízení není.
 *
 * Měří se `git ls-files`, protože právě rozdíl mezi diskem a repem je ta vada.
 * Univerzum se HLEDÁ: deklarace modulů říká, které třídy mají existovat.
 */
const ROOT = process.cwd();

const sledovane = (vzor: string): string[] =>
  execFileSync('git', ['ls-files', vzor], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

describe('vlastní modul appky má v gitu obě půlky', () => {
  const deklarace = sledovane('mobile-app/modules/*/expo-module.config.json');

  it('kontrolní vzorek: nějaký vlastní modul vůbec existuje', () => {
    // Prázdné univerzum by vyrobilo zelenou, která nic neměří.
    expect(deklarace.length).toBeGreaterThan(0);
  });

  it.each(deklarace)('%s — každá deklarovaná android třída je sledovaná gitem', (cesta) => {
    const j = JSON.parse(readFileSync(resolve(ROOT, cesta), 'utf8')) as {
      android?: { modules?: string[] };
    };
    const tridy = j.android?.modules ?? [];
    if (tridy.length === 0) return;
    const korenModulu = cesta.replace(/\/expo-module\.config\.json$/, '');
    const vSouborech = sledovane(`${korenModulu}/android/**`);
    for (const trida of tridy) {
      const jmeno = trida.split('.').pop()!;
      expect(
        vSouborech.some((f) => f.endsWith(`/${jmeno}.kt`) || f.endsWith(`/${jmeno}.java`)),
        `${cesta} deklaruje '${trida}', ale žádný sledovaný soubor v ${korenModulu}/android/ ho nenese.\n` +
          `Na disku být může — v repu není, takže se do buildu nedostane.\n` +
          `Sledováno: ${vSouborech.join(', ') || '(nic)'}`,
      ).toBe(true);
    }
    // Bez sestavovacího předpisu se nativní půlka nepřeloží, i když v repu je.
    expect(vSouborech.some((f) => /\/build\.gradle(\.kts)?$/.test(f)), `${korenModulu}/android/build.gradle chybí v gitu`).toBe(true);
  });
});
