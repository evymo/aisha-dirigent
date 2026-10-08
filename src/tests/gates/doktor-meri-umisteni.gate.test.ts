/**
 * Brána: doktor měří shodu umístění manifest × profil DŘÍV, než cold-start cokoli zapíše
 *
 * ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku, 4. pokus): rozpor u 8 služeb zastavil cold-start
 * až v kroku 4 (coolify-sync-envs) — po zápisu env do Coolify a po založení nové
 * aplikace. Kontrola sama (assert_placement_agrees) byla správná, jen stála pozdě.
 *
 * Měří se zapojení: doktor (fáze E) volá lib/umisteni-souhlasi.sh nad manifestem,
 * rozpor je `fail` (ne výpis) a nezměřitelné je `fail` NEMĚŘENO (ne shoda).
 * Chování obalu (shoda, negativní sonda přesunem aplikace, NEMĚŘENO bez profilu)
 * měří scripts/lib/umisteni-souhlasi.test.mjs.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DOKTOR = readFileSync(join(ROOT, 'scripts/cold-start-doctor.sh'), 'utf8');
const OBAL = readFileSync(join(ROOT, 'scripts/lib/umisteni-souhlasi.sh'), 'utf8');
const COLD = readFileSync(join(ROOT, 'scripts/aisha-cold-start.sh'), 'utf8');

describe('doktor měří shodu umístění manifest × profil', () => {
  it('obal pouští tutéž funkci jako sync-envs nad umístěním čerstvě odvozeným z profilu', () => {
    expect(OBAL).toMatch(/derive-domains\.mjs" --shell/);
    expect(OBAL).toMatch(/\bload_app_compose_map "\$manifest"/);
    expect(OBAL).toMatch(/\bassert_placement_agrees\b/);
    // Druhá polovina téže otázky ve stejném kroku: smí služba bydlet tam, kam ji
    // oba posílají (neznámý slot, hlavní mesh nebo veřejná tvář na GPU slotu).
    expect(OBAL).toMatch(/umisteni-slotu\.mjs"/);
  });

  it('fáze E doktora obal volá a nález promítá do verdiktu', () => {
    const faze = DOKTOR.slice(DOKTOR.indexOf('phase E "'));
    const usek = faze.slice(0, faze.indexOf('\n  manifest="$MANIFEST"\n'));
    expect(usek, 'kontrola umístění není ve fázi E před kontrolou compose').toMatch(/umisteni-souhlasi\.sh" "\$MANIFEST"/);
    expect(usek).toMatch(/1\) fail "umístění: rozpor \(manifest × profil, nebo služba na slotu, kam nesmí\)/);
    expect(usek).toMatch(/\*\) fail "umístění manifest × profil NEMĚŘENO/);
  });

  it('⛔ plánovaný wipe a rewarmup jen z PŘEPÍNAČŮ: proměnná prostředí nic neodemkne (skutečný blok argumentů)', () => {
    const zacatek = DOKTOR.indexOf('WIPE_PLANNED=0');
    const konec = DOKTOR.indexOf('\ndone\n', zacatek);
    expect(zacatek > 0 && konec > zacatek, 'blok argumentů doktora nenalezen').toBe(true);
    const blok = DOKTOR.slice(zacatek, konec + 6);
    const spust = (args: string[], env: Record<string, string>) =>
      spawnSync('bash', ['-c', `fail(){ echo "FAIL $*"; }\nset -- "$@"\n${blok}\necho "W=$WIPE_PLANNED R=$REWARMUP_PLANNED"`, 'doktor', ...args], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', ...env },
      }).stdout.trim();
    expect(spust([], { AISHA_WIPE_PLANNED: '1', AISHA_REWARMUP_PLANNED: 'inst-x' })).toBe('W=0 R=');
    expect(spust(['--wipe-planned', '--rewarmup-planned=inst-x'], {}), 'kotva: přepínače platí').toBe('W=1 R=inst-x');
  });

  it('fáze F doktora měří přesun existující aplikace (U3) a STOP promítá do verdiktu', () => {
    // Změna umístění se u existující aplikace nepromítne (Coolify mění server jen při
    // založení) — krok 0 musí nahlas říct DRŽENO, nebo STOP s cestou --rewarmup.
    const faze = DOKTOR.slice(DOKTOR.indexOf('phase F "'), DOKTOR.indexOf('phase P "'));
    expect(faze, 'fáze F kontrolu přesunu nevolá').toMatch(/lib\/presun-aplikaci\.mjs" "\$\{_pr_args\[@\]\}"/);
    expect(faze).toMatch(/1\) fail "přesun aplikace čeká — konvergence by ji NEPŘESUNULA/);
    expect(faze).toMatch(/\*\) warn "přesun aplikací NEZMĚŘEN/);
    // Plánovaná operace, která přesun provede sama (wipe, rewarmup), se předá — jinak
    // by STOP zablokoval i cestu ven (revize accel-1, 10-05).
    expect(faze).toMatch(/_pr_args\+=\(--planovany-wipe\)/);
    expect(faze).toMatch(/_pr_args\+=\(--planovany-rewarmup "\$REWARMUP_PLANNED"\)/);
    expect(COLD).toMatch(/_doctor_args\+=\("--rewarmup-planned=\$\{REWARMUP_APPS\}"\)/);
    // Plánovaný rewarmup jen z přepínače cold-startu, ne z prostředí (to by STOP odemklo bez operace).
    expect(DOKTOR).not.toMatch(/REWARMUP_PLANNED="\$\{AISHA_REWARMUP_PLANNED/);
    // Totéž pro wipe (revize accel-1, 3. kolo): jen přepínač, který cold-start předá s --wipe.
    expect(DOKTOR).not.toMatch(/AISHA_WIPE_PLANNED/);
    expect(COLD).toMatch(/\[ "\$WIPE" = "1" \] && _doctor_args\+=\(--wipe-planned\)/);
    // UUID slotů jdou z discovery TÉHOŽ běhu, ne ze starého souboru prostředí.
    expect(faze).toMatch(/printf '%s\\n' "\$disc" \| sed -n "s\/\^\\\(COOLIFY_SERVER_UUID_/);
  });
});
