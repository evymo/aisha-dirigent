import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Slova Mission Control jdou ze slovníku — důkaz na VÝSLEDKU, ne na instalatérství.
 *
 * ⛔ NAMĚŘENO 2026-09-05: `@aisha/extranet-sdk-ui` nese `DEF_LABELS` — 35 řetězců
 * natvrdo česky. Shell z nich přebíjel tři, takže 32 slov (`'Úloha'`,
 * `'Rádio · komunikace agentů'`, `'Schválit — výjezd z boxu'`, …) se kreslilo
 * česky i německému, francouzskému, ruskému a thajskému uživateli.
 *
 * ⭐ PROČ TENHLE TEST VEDLE BRÁNY. Brána
 * `mission-control-slova-dodava-host.gate.test.ts` měří, že shell každé slovo
 * DODÁVÁ. To je instalatérství. Tohle měří, co z kohoutku TEČE: že se `t()`
 * opravdu trefí do slovníku a vrátí němčinu, ne klíč a ne češtinu. Zelená brána
 * bez tohohle testu by znamenala „nic se nerozbilo", ne „mluví německy".
 *
 * ⭐ SLOVNÍK SE ČTE SKUTEČNÝ, NE FIXTURA. Kdyby tu stála vlastní tabulka slov,
 * test by prošel i ve chvíli, kdy je platformní slovník prázdný — měřil by sám
 * sebe.
 */
const CONTENT = join(__dirname, '../../../src/i18n/content');
const slovnik = (loc: string): Record<string, string> =>
  JSON.parse(readFileSync(join(CONTENT, loc, 'extranet.json'), 'utf8'));

const bundle = {
  config: {
    instance_slug: 'test',
    api: { postgrest_url: 'http://x', token_exchange_url: 'http://x' },
    auth: { issuer: 'http://x', client_id: 'c' },
    i18n: { default_locale: 'cs', locales: ['cs', 'de', 'en'] },
    snapshot_public_jwk: null,
    preview: { enabled: false },
  },
  // Floor = přesně to, co se veze v buildu. Runtime (DB) je v testu prázdný,
  // takže se měří ta HORŠÍ z obou cest: nepřihlášený / selhané načtení.
  i18n: { en: slovnik('en'), cs: slovnik('cs'), de: slovnik('de') },
};

(globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = bundle;
const { setLocale } = await import('../src/i18n.js');
const { missionControlLabels } = await import('../src/components/blocks.js');

/** Písmena, která má čeština a němčina ne — únik češtiny je pak vidět bez znalosti obou jazyků. */
const CESKA_PISMENA = /[ěščřžůďťň]/i;

describe('Mission Control mluví jazykem uživatele', () => {
  it('dodává se CELÝ slovník komponenty, ne pár slov', () => {
    /**
     * ⛔ Bez téhle věty by byl zbytek testu VAKUOVÝ: kdyby shell přestal
     * labely dodávat, `missionControlLabels()` vrátí pár klíčů, mezi nimiž
     * žádná čeština není — a testy níž by prošly, zatímco komponenta by
     * kreslila `DEF_LABELS`, tedy přesně tu češtinu, kvůli které to celé
     * vzniklo. Kolik slov to má být, měří brána
     * `mission-control-slova-dodava-host` proti balíku; tady stačí podlaha,
     * pod kterou je pravděpodobnější odpojený seznam než malá komponenta.
     */
    const labels = missionControlLabels('app.blocks.mc_tower.title');
    expect(Object.keys(labels).length).toBeGreaterThanOrEqual(30);
  });

  it('žádný label není syrový klíč — v češtině', () => {
    setLocale('cs');
    const labels = missionControlLabels('app.blocks.mc_tower.title');
    const syrove = Object.entries(labels)
      .filter(([, v]) => typeof v === 'string' && /^app\./.test(v as string))
      .map(([k]) => k);
    expect(syrove, `labely, které se nenašly ve slovníku: ${syrove.join(', ')}`).toEqual([]);
  });

  it('⛔ v NĚMČINĚ neprosákne ani jedno české slovo', () => {
    setLocale('de');
    const labels = missionControlLabels('app.blocks.mc_tower.title');
    const cesky = Object.entries(labels)
      .filter(([, v]) => typeof v === 'string' && CESKA_PISMENA.test(v as string))
      .map(([k, v]) => `${k}="${String(v)}"`);
    expect(
      cesky,
      'Tohle by německý uživatel viděl česky — slovo tedy nejde ze slovníku, ' +
        `ale z DEF_LABELS v balíku: ${cesky.join(', ')}`,
    ).toEqual([]);
  });

  it('slova se opravdu MĚNÍ s jazykem (ne jen „nejsou česká")', () => {
    // Bez téhle věty by test prošel i tehdy, kdyby `t()` vracelo pro každý
    // jazyk touž angličtinu — a to je jiná vada se stejným příznakem.
    setLocale('cs');
    const cs = missionControlLabels('app.blocks.mc_tower.title');
    setLocale('de');
    const de = missionControlLabels('app.blocks.mc_tower.title');
    const stejne = Object.keys(cs).filter(
      (k) => typeof cs[k] === 'string' && cs[k] === de[k],
    );
    // Kognáty existují (`Model`, `Tokens`), takže shoda VŠEHO je vada, ne shoda pár slov.
    expect(stejne.length, `shodných labelů: ${stejne.join(', ')}`).toBeLessThan(5);
    expect(cs.colTask).toBe('Úloha');
    expect(de.colTask).toBe('Aufgabe');
  });

  it('sectorMsg je funkce a doplní všechny čtyři hodnoty', () => {
    setLocale('cs');
    const labels = missionControlLabels('app.blocks.mc_tower.title');
    const fn = labels.sectorMsg as (a: string, b: string, c: string, d: string) => string;
    const veta = fn('B-1', 'Naložení', '12,3 s', 'Přeprava');
    expect(veta).toContain('B-1');
    expect(veta).toContain('Naložení');
    expect(veta).toContain('12,3 s');
    expect(veta).toContain('Přeprava');
    // Nedoplněná interpolace je vada, kterou by pouhé `toContain` přehlédlo.
    expect(veta, 've větě zůstala nenahrazená interpolace').not.toMatch(/\{\{/);
  });
});
