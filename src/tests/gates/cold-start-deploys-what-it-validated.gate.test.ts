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
import { zManifestu } from '../../../scripts/lib/nasazovany-repozitar.mjs';

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
    // Větev (i repozitář) vydá JEDEN výklad deklarace — scripts/lib/nasazovany-repozitar.mjs,
    // týž vstup, ze kterého story-init skládá `git_repository`. Krok ji dostane z $MANIFEST;
    // fork s vlastní deploy větví projde touž cestou (chování výkladu měří jeho test
    // a brána nasazeni-repozitar-podle-identity).
    expect(
      blok,
      'větev se musí číst z $MANIFEST (`branch:`) výkladem deklarace, ne z literálu',
    ).toMatch(/_deploy_dekl="\$\(node "\$\{REPO_ROOT\}\/scripts\/lib\/nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --deklarace\)"/);
    // Třetí sloupec výkladu (cesta `org/repo`) čte story-init; krok 2b2 ho zahazuje.
    expect(blok, 'a z výstupu výkladu si vzít jméno větve').toMatch(/read -r _deploy_branch _deploy_repo _ <<< "\$_deploy_dekl"/);
    expect(zManifestu('repo: a/b\nbranch: nasazeni\n').vetev, 'výklad čte `branch:` manifestu').toBe('nasazeni');
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
    // Hlavu čte výklad deklarace z repozitáře, ZE KTERÉHO COOLIFY STAVÍ (remote podle
    // identity URL, ne podle jména). `ls-remote origin` v kroku byl vadou: ve fork
    // checkoutu je origin upstream a krok porovnával s repozitářem, ze kterého se nestaví.
    expect(blok, 'musí přečíst hlavu vzdálené větve nasazovaného repozitáře').toMatch(
      /node "\$\{REPO_ROOT\}\/scripts\/lib\/nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --repo-root "\$REPO_ROOT" --cti/,
    );
    const kod = blok
      .split('\n')
      .filter((r) => !r.trimStart().startsWith('#'))
      .join('\n');
    expect(kod, 'remote se nesmí jmenovat literálem — `origin` je zvyklost, ne vlastnost').not.toMatch(/ls-remote\s+origin\b/);
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

  // ⛔ Recenze 2026-10-04: rozpor deklarace s prostředím (GIT_BRANCH jiný než větev
  // manifestu) znal jen story-init v kroku 3. Běh prošel doktorem i krokem 2b2 a spadl
  // až PO kroku 2c — instance smazaná, aplikace nezaložené. Pozná ho teď vykladač
  // sám v režimu --deklarace (chování: scripts/lib/nasazovany-repozitar.test.mjs,
  // včetně skutečného úseku tohohle kroku a mutanta, který prostředí zakryje).
  it('rozpor deklarace s prostředím se pozná PŘED odloženým wipem — v kroku 2b2, ne až ve story-initu', () => {
    const volani = '_deploy_dekl="$(node "${REPO_ROOT}/scripts/lib/nasazovany-repozitar.mjs" --manifest "$MANIFEST" --deklarace)"';
    const kdeVolani = content.indexOf(volani);
    const wipe = content.indexOf('step "2c.');
    const storyInit = content.indexOf('scripts/coolify-story-init.sh" --manifest "$MANIFEST"');
    expect(kdeVolani, 'krok 2b2 nevolá výklad deklarace — kotva osiřela').toBeGreaterThan(content.indexOf('step "2b2'));
    expect(kdeVolani, 'výklad, který rozpor pozná, musí stát PŘED odloženým wipem').toBeLessThan(wipe);
    expect(storyInit, 'story-init v cold-startu nenalezen — kotva osiřela').toBeGreaterThan(-1);
    expect(storyInit, 'story-init (týž výklad podruhé) běží až PO wipu — proto nestačí').toBeGreaterThan(wipe);
    // Volání nesmí prostředí zakrýt: jinak by krok o GIT_BRANCH nevěděl (mutant
    // „krok 2b2 nezná tvrzení z prostředí“). Měří se řádek volání, ne komentář.
    const radekVolani = content.slice(content.lastIndexOf('\n', kdeVolani) + 1, content.indexOf('\n', kdeVolani));
    expect(radekVolani).toMatch(/^if ! _deploy_dekl="\$\(node /);
    expect(radekVolani, 'prostředí volání vykladače se nesmí měnit').not.toMatch(/GIT_BRANCH=|\benv\b|\bunset\b/);
    // Nenulový kód výkladu běh ZASTAVÍ — ještě v kroku 2b2.
    const zaVolanim = content.slice(kdeVolani, wipe);
    expect(zaVolanim.slice(0, 600), 'rozpor musí krok zastavit').toMatch(/--deklarace\)"; then[\s\S]{0,400}?exit 1\s+fi/);
    // A doktor (krok 0) se ptá téhož vykladače — běh spadne už tam, s touž hláškou.
    const doktor = readFileSync(join(ROOT, 'scripts/cold-start-doctor.sh'), 'utf8');
    expect(doktor, 'doktor nekontroluje deklaraci nasazení proti prostředí').toMatch(
      /nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --vyklad --tvrdi-prostredi/,
    );
    expect(content.indexOf('step "0. PREFLIGHT DOCTOR'), 'doktor běží před krokem 2b2').toBeLessThan(content.indexOf('step "2b2'));
  });

  it('dry-run kontrolu neprovádí destruktivně, jen ohlásí', () => {
    const blok = blokKontroly();
    expect(blok, 'dry-run má plán vypsat, ne padat na stavu stromu').toMatch(
      /if \[ "\$DRY_RUN" = "1" \][\s\S]{0,300}?\[DRY RUN\]/,
    );
  });
});
