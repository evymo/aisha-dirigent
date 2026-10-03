/**
 * Brána: k instančnímu overlayi vedou JEDNY dveře
 *
 * VZNIKLA Z MĚŘENÍ (2026-08-01/02): tři místa si cestu k overlayi zjišťovala
 * každé zvlášť — `allowlisted-rpc-has-source` varovalo a prošlo,
 * `check-i18n-parity` tiše měřil míň a `derive-domains` spadl na šablonu. Ani
 * jedno není špatně napsané; špatně je, že o tom rozhodovalo každé samo.
 * Důsledek byl pokaždé stejný: kontrola prošla, aniž by prohlédla to hlavní.
 *
 * A není to teorie. `derive-domains.mjs` nese měřený incident z 2026-07-28:
 * proměnná BYLA správně deklarovaná, jen ji konzument doplnil až po vyhodnocení
 * importu, takže se v module scope přečetla prázdná a instanční profil se
 * nenačetl. Tichý fallback na šablonu, žádná chyba.
 *
 * CO BRÁNA HLÍDÁ: `AISHA_INSTANCE_CONFIG_DIR` smí číst JEDINĚ
 * `scripts/lib/instance-overlay.mjs`. Kdo overlay potřebuje, jde přes něj a tím
 * si vybere režim — `requireOverlay()` (bez overlaye nemá co měřit, spadne)
 * nebo `overlayDir()` (měří míň a musí to nahlas říct). Nová brána tak nemůže
 * vzniknout jako tichý no-op: dveře jsou jen jedny.
 *
 * PROČ TO STAČÍ HLÍDAT STATICKY: jde o to, KDO tu proměnnou čte, a to je vidět
 * ve zdroji. Že rozcestník čte líně, hlídá druhý test níž — kdyby se čtení
 * vrátilo do module scope, vrátí se i past z 28. 7.
 *
 * Spouští se přes: npm run test:gates -- overlay-jde-jen-jednemi-dvermi
 */

import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ROZCESTNIK = 'scripts/lib/instance-overlay.mjs';
const PROMENNA = 'AISHA_INSTANCE_CONFIG_DIR';

/** Prohledávané stromy — kód, který se pouští, ne dokumentace. */
const STROMY = ['src', 'scripts', 'apps', 'packages'];
const PRIPONY = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];

function souboryPod(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const projdi = (p: string) => {
    for (const polozka of readdirSync(p)) {
      if (polozka === 'node_modules' || polozka === 'dist' || polozka === '.git') continue;
      const cesta = join(p, polozka);
      if (statSync(cesta).isDirectory()) projdi(cesta);
      else if (PRIPONY.some((e) => polozka.endsWith(e))) out.push(cesta);
    }
  };
  projdi(abs);
  return out;
}

describe('k instančnímu overlayi vedou jedny dveře', () => {
  test('rozcestník existuje (bez něj nemá brána co hlídat)', () => {
    expect(
      existsSync(join(ROOT, ROZCESTNIK)),
      `${ROZCESTNIK} chybí — buď se přesunul, a pak patří opravit tahle brána, ` +
        `nebo ho někdo smazal, a pak se rozpadlo jediné místo, které o overlayi rozhoduje`,
    ).toBe(true);
  });

  test(`${PROMENNA} čte jedině rozcestník`, () => {
    const cizi: string[] = [];
    for (const strom of STROMY) {
      for (const soubor of souboryPod(strom)) {
        const rel = soubor.slice(ROOT.length + 1);
        if (rel === ROZCESTNIK) continue;
        const obsah = readFileSync(soubor, 'utf8');
        // Zajímá nás ČTENÍ z prostředí, ne zmínka v komentáři ani v hlášce.
        if (new RegExp(`process\\.env(\\.${PROMENNA}|\\[['"\`]${PROMENNA}['"\`]\\])`).test(obsah)) {
          cizi.push(rel);
        }
      }
    }
    expect(
      cizi,
      `Tyhle soubory si cestu k overlayi zjišťují samy, mimo ${ROZCESTNIK}:\n  ` +
        `${cizi.join('\n  ')}\n\n` +
        `Každé takové místo si znovu vymýšlí, co dělat, když overlay chybí — a dosud ` +
        `z toho pokaždé vyšel tichý průchod: kontrola prošla, aniž prohlédla to hlavní.\n` +
        `Použij rozcestník a VYBER režim:\n` +
        `  requireOverlay('jméno kontroly')  — bez overlaye nemá co měřit, ať spadne;\n` +
        `  overlayDir()                      — měří míň a musí to nahlas říct;\n` +
        `  overlayDirOrRequired('jméno')     — obojí, přísnost řídí prostředí (CI).`,
    ).toEqual([]);
  });

  test('rozcestník čte cestu LÍNĚ, ne v module scope', () => {
    const src = readFileSync(join(ROOT, ROZCESTNIK), 'utf8');
    // Řádek na nejvyšší úrovni, který si hodnotu uloží do konstanty, je přesně
    // ta past z 2026-07-28: import se vyhodnotí dřív, než ji konzument doplní.
    const vModuleScope = /^(?:const|let|var)\s+\w+\s*=\s*process\.env/m.test(src);
    expect(
      vModuleScope,
      `${ROZCESTNIK} čte ${PROMENNA} v module scope. Měřeno 2026-07-28: konzument, ` +
        `který si proměnnou hydratuje sám, na takové čtení nedosáhne včas — cesta ` +
        `zůstane prázdná a výsledkem je tichý fallback, ne chyba. Čti ji uvnitř funkce.`,
    ).toBe(false);
  });
});
