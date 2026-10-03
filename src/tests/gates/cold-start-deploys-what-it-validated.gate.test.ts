/**
 * Gate test: cold-start-deploys-what-it-validated
 *
 * Zamyká invariant: cold-start nesmí nasadit jiný kód, než jaký zvalidoval.
 *
 * Krok 2b (`preflight-compose.sh`) ověřuje compose soubory v PRACOVNÍM STROMĚ.
 * Coolify je ale nikdy nevidí — klonuje si repo sám a staví z větve deklarované
 * v manifestu (`branch:`, čte ji `coolify-story-init.sh`, default `main`).
 * Když se strom od té větve liší, validuje se jeden kód a nasazuje druhý.
 *
 * Naměřeno 2026-08-19: oprava vadného Traefik labelu ležela v necommitnuté
 * větvi. `--wipe` postavil starý `main`, celý běh doběhl a následné ověření
 * „opravy" měřilo neopravený stack — hledala se šestá příčina vady, která byla
 * dávno diagnostikovaná. Do té chvíle neobsahoval `aisha-cold-start.sh` JEDINÉ
 * volání gitu nad vlastním repem.
 *
 * Táž třída jako `curl-http-code-capture-integrity` (#79): výstup vypadá jako
 * měření, ale odpovídá na jinou otázku.
 *
 * Brána měří VLASTNOSTI, ne řetězce:
 *   1. jméno deploy větve se ČTE z manifestu (není to literál `main`),
 *   2. lokální HEAD se porovnává s `git ls-remote` téže větve,
 *   3. nepřečtená vzdálená hodnota je FAIL, ne „v pořádku" (fail-closed),
 *   4. kontrola stojí PŘED odloženým wipem (validate-before-destroy).
 *
 * Run via: `npm run test:gates`
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/aisha-cold-start.sh');
const content = readFileSync(SCRIPT, 'utf8');

/** Blok kontroly: od značky kroku 2b2 po značku dalšího kroku. */
function blokKontroly(): string {
  const zacatek = content.indexOf('step "2b2');
  expect(
    zacatek,
    'aisha-cold-start.sh musí mít krok 2b2 — bez něj nikdo neměří, jestli se nasazuje zvalidovaný strom',
  ).toBeGreaterThan(-1);
  const konec = content.indexOf('step "2c.', zacatek);
  expect(konec, 'za krokem 2b2 musí následovat krok 2c (odložený wipe)').toBeGreaterThan(zacatek);
  return content.slice(zacatek, konec);
}

describe('cold-start-deploys-what-it-validated — nasadí se jen to, co prošlo preflightem', () => {
  it('jméno deploy větve se odvozuje z manifestu, ne z literálu', () => {
    const blok = blokKontroly();
    expect(
      blok,
      'větev se musí číst z $MANIFEST (`branch:`) — fork s vlastní deploy větví musí projít touž cestou',
    ).toMatch(/awk[^\n]*\^branch:[^\n]*"\$MANIFEST"/);
    // Literál `main` smí být nanejvýš jako fallback ${...:-main}, nikdy jako
    // jediný zdroj — jinak brána měří NÁŠ tvar běhu místo vlastnosti.
    //
    // Měří se KÓD, ne próza: komentáře incident popisují a jméno větve v nich
    // padne přirozeně. Číst je jako kód je táž vada jako u brány
    // env-doctor-contract-coverage, která hlásila ${VAR} z komentářů compose.
    const kod = blok
      .split('\n')
      .filter((r) => !r.trimStart().startsWith('#'))
      .join('\n');
    const literaly = kod.match(/(?<!:-)\bmain\b/g) ?? [];
    expect(
      literaly,
      'v kódu nesmí být `main` jinak než jako fallback — jméno větve je deklarace, ne konstanta',
    ).toEqual([]);
  });

  it('lokální HEAD se porovnává s hlavou vzdálené deploy větve', () => {
    const blok = blokKontroly();
    expect(blok, 'musí přečíst HEAD pracovního stromu').toMatch(/git -C "\$REPO_ROOT" rev-parse HEAD/);
    expect(blok, 'musí přečíst hlavu vzdálené větve').toMatch(
      /git -C "\$REPO_ROOT" ls-remote origin "refs\/heads\/\$\{_deploy_branch\}"/,
    );
    expect(blok, 'a obě hodnoty POROVNAT').toMatch(/\[ "\$_head_lokal" != "\$_head_vzdal" \]/);
  });

  it('nepřečtená hodnota je FAIL, ne tichý průchod (fail-closed)', () => {
    const blok = blokKontroly();
    for (const promenna of ['_head_lokal', '_head_vzdal']) {
      const test = new RegExp(`if \\[ -z "\\$${promenna}" \\][\\s\\S]{0,600}?\\n\\s*fi`, 'm');
      const vetev = blok.match(test)?.[0];
      expect(vetev, `prázdné ${promenna} musí mít vlastní větev — mlčení sondy je nález`).toBeTruthy();
      expect(
        vetev,
        `prázdné ${promenna} musí skript ZASTAVIT; číst nepřečtenou hodnotu jako shodu je ta vada, kterou brána zavírá`,
      ).toMatch(/exit 1/);
    }
  });

  it('necommitnuté změny zastaví běh — Coolify je nikdy neuvidí', () => {
    const blok = blokKontroly();
    expect(blok, 'musí se ptát na stav pracovního stromu').toMatch(/git -C "\$REPO_ROOT" status --porcelain/);
    expect(blok, 'a při neprázdném výstupu skončit').toMatch(
      /if \[ -n "\$_strom_zmeny" \][\s\S]{0,800}?exit 1/,
    );
  });

  it('kontrola stojí PŘED destruktivním wipem (validate-before-destroy)', () => {
    const kontrola = content.indexOf('step "2b2');
    const wipe = content.indexOf('step "2c.');
    const create = content.indexOf('step "3. CREATE COOLIFY APPLICATIONS');
    expect(kontrola).toBeGreaterThan(-1);
    expect(wipe, 'nesrovnalost musí padnout, dokud stará platforma ještě žije').toBeGreaterThan(kontrola);
    expect(create, 'a rozhodně dřív, než se zakládají aplikace').toBeGreaterThan(kontrola);
  });

  it('dry-run kontrolu neprovádí destruktivně, jen ohlásí', () => {
    const blok = blokKontroly();
    expect(blok, 'dry-run má plán vypsat, ne padat na stavu stromu').toMatch(
      /if \[ "\$DRY_RUN" = "1" \][\s\S]{0,300}?\[DRY RUN\]/,
    );
  });
});
