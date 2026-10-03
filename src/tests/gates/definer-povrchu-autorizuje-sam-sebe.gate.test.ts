/**
 * Brána: SECURITY DEFINER, který vydává data povrchu, se musí ptát na NÁROK
 *
 * VZNIKLA Z ŽIVÉHO NÁLEZU (produkce, 2026-08-01). Uživatel BEZ JEDINÉ ROLE
 * dostal z chatu celkový roční nájem, počet nájemců i největšího nájemce jménem
 * a s částkou — zatímco z každého bloku nad TÝMIŽ daty dostal 0 řádků. Opravou
 * (`get_answer_block`) se ale zavřely jedny dveře ze šesti: sesterské funkce nad
 * týmiž daty se nároku neptají dodnes.
 *
 * MECHANISMUS: `SECURITY DEFINER` běží pod právy vlastníka, takže RLS neplatí a
 * autorizaci si funkce musí udělat SAMA. Tahle brána stojí vedle
 * `definer-nesmi-obchazet-invoker`, která hlídá JINÝ způsob, jak se to pokazí
 * (definer obalí cizí INVOKER funkci a spolehne se na jeho RLS). Tady jde o
 * definer, který si data obstará sám a nikoho se nezeptá — proto ho ta druhá
 * brána chytit nemohla.
 *
 * ⭐ ROZDÍL, NA KTEROM TO CELÉ STOJÍ: „je někdo přihlášen" NENÍ nárok.
 *   `if v_uid is null and not is_service_role() then` odmítne anonymní volání —
 *   a přihlášenému bez jediné role vydá všechno. Přesně tenhle řádek měly
 *   všechny čtyři `get_answer_chain_*` v době nálezu. Nárok je otázka „SMÍ
 *   TENHLE ČLOVĚK vidět TAHLE data" (`is_admin_or_staff()`, audience, scope).
 *
 * CO BRÁNA MĚŘÍ: SoT funkce, která je `security definer` A vydává tvar povrchu
 * (`data` + `provenance` v `jsonb_build_object`), musí v těle konzultovat nárok.
 * Univerzum si HLEDÁ ve zdroji — nová odpovědní funkce je pod bránou od prvního
 * commitu, nikdo ji nemusí nikam dopisovat.
 *
 * PROČ STATICKY: tady stačí zápis. Chybějící volání nároku je vidět ve zdroji a
 * brána tak padne v PR, ne až nad běžící databází. Runtime protějšek (co funkce
 * skutečně vydá které identitě) měří `src/tests/db/surface-block-contract`.
 *
 * Spouští se přes: npm run test:gates -- definer-povrchu-autorizuje
 */

import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, 'aisha/db/sql/functions');
const BASELINE_PATH = join(ROOT, 'src/tests/gates/definer-povrchu-autorizuje-sam-sebe.baseline.json');

/**
 * Výrazy, které NĚKOHO AUTORIZUJÍ — ptají se, co ten člověk smí.
 * `is_service_role()` v seznamu chybí ZÁMĚRNĚ: to je obcházka pro službu, ne
 * nárok uživatele, a sama o sobě nikoho neodmítne.
 */
const NAROK = [
  /is_admin_or_staff\s*\(/i,
  /surface_audience_allows\s*\(/i,
  /workflow_step_visible_to\s*\(/i,
  /is_story_participant\s*\(/i,
  /has_document_claim\s*\(/i,
  /scope_[a-z_]*\s*\(/i,
  // Delegace na rozhodovač nároku. `get_batch_workflow_progress` vrací
  // `{"ok": false, "error": "not visible"}` všem, kdo na běh nemají nárok
  // (admin/staff/service, nebo krok viditelný přes workflow_step_visible_to),
  // takže vnější dotaz filtrující `(prog->>'ok')` JE autorizace — jen ji
  // statická brána skrz volání nevidí. Doměřeno 2026-09-12 fixturou se DVĚMA
  // běhy: admin viděl oba, řidič jen svůj. Důkaz drží runtime brána
  // `definer-narok-ne-jen-prihlaseni` — tady je jen jméno delegáta.
  /get_batch_workflow_progress\s*\(/i,
];

/** Odstraní SQL komentáře — prosa o pravidle nesmí pravidlo splnit. */
function bezKomentaru(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/** Vydává funkce tvar povrchu? (`data` i `provenance` do jsonb obálky) */
function vydavaTvarPovrchu(sql: string): boolean {
  return /jsonb_build_object/i.test(sql) && /'data'/.test(sql) && /'provenance'/.test(sql);
}

describe('SECURITY DEFINER vydávající data povrchu se musí ptát na nárok', () => {
  const soubory = existsSync(FUNCTIONS_DIR)
    ? readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith('.sql'))
    : [];

  test('měřidlo má co měřit (SoT funkce existují)', () => {
    expect(soubory.length).toBeGreaterThan(100);
  });

  const definerPovrchu: string[] = [];
  const bezNaroku: string[] = [];

  for (const soubor of soubory) {
    const sql = bezKomentaru(readFileSync(join(FUNCTIONS_DIR, soubor), 'utf8'));
    if (!/security\s+definer/i.test(sql)) continue;
    if (!vydavaTvarPovrchu(sql)) continue;
    definerPovrchu.push(soubor);
    if (!NAROK.some((re) => re.test(sql))) bezNaroku.push(soubor.replace(/\.sql$/, ''));
  }

  test('univerzum není prázdné (jinak by zelená znamenala „nic jsem nenašel")', () => {
    expect(
      definerPovrchu.length,
      'žádná definer funkce nevydává tvar povrchu — buď se změnil idiom, nebo brána měří vedle',
    ).toBeGreaterThan(3);
  });

  test('žádná z nich nespoléhá jen na to, že je někdo přihlášen', () => {
    // Známý dluh, aby brána šla ZAPOJIT dřív, než se opraví — týž idiom jako
    // `aisha-branding.baseline.json`: dluh smí jen klesat. Co v seznamu není,
    // běh shodí; co se opraví, se jen ohlásí (oprava se netrestá).
    const baseline: { functions: string[] } = existsSync(BASELINE_PATH)
      ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
      : { functions: [] };
    const nove = bezNaroku.filter((f) => !baseline.functions.includes(f));
    const opravene = baseline.functions.filter((f) => !bezNaroku.includes(f));
    if (opravene.length > 0) {
      console.warn(`[brána nároku] OPRAVENO — smaž z baseline: ${opravene.join(', ')}`);
    }
    if (bezNaroku.length > nove.length) {
      console.warn(
        `[brána nároku] známý dluh (baseline), neshazuje: ` +
          `${bezNaroku.filter((f) => !nove.includes(f)).join(', ')}`,
      );
    }
    expect(
      nove,
      `Tyhle funkce běží pod právy vlastníka (RLS na ně neplatí), vydávají data povrchu ` +
        `a NEPTAJÍ SE, co volající smí:\n  ${bezNaroku.join('\n  ')}\n\n` +
        `„Je někdo přihlášen" (auth.uid() is null / is_service_role) nárok NENÍ — ` +
        `uživatel bez jediné role projde. Vzor opravy je v get_answer_block.sql:\n` +
        `  if not (public.is_service_role() or public.is_admin_or_staff()) then\n` +
        `    return v_empty;   -- prázdno, ne chyba: kdo nemá nárok, se nemá dozvědět\n` +
        `  end if;             -- ani to, že se ptal na něco existujícího\n\n` +
        `Naměřeno na produkci 2026-08-01: bezrolový uživatel dostal z takové funkce ` +
        `firemní čísla, zatímco ze všech bloků nad týmiž daty dostal nulu.`,
    ).toEqual([]);
  });
});
