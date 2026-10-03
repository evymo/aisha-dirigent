/**
 * Brána: SECURITY DEFINER nesmí volat datovou SECURITY INVOKER funkci
 *
 * VZNIKLA Z ŽIVÉHO NÁLEZU (produkce, 2026-07-31). Uživatel BEZ JAKÝCHKOLI ROLÍ
 * dostal přes `assemble_surface_traced('workbench')` 631 kB dat — 500 dokladů,
 * 509 závazků, 164 nálezů — přestože tytéž bloky přes `get_block_data` dostal
 * PRÁZDNÉ.
 *
 * MECHANISMUS (proč to statická kontrola smí hlídat):
 *   `SECURITY INVOKER` znamená „běž pod právy volajícího". Když INVOKER funkci
 *   zavolá SECURITY DEFINER funkce, tím volajícím UŽ NENÍ uživatel — je jím
 *   vlastník definera (superuser s RLS bypass). Celá doktrína repa
 *   („datové RPC jsou INVOKER, o viditelnosti rozhoduje RLS") je tak obejita
 *   jedním voláním o úroveň výš. Nejde o teorii: sesterské bloky nad týmiž
 *   daty se chovaly správně, únik dělal jediný obalovací definer.
 *
 * CO BRÁNA HLÍDÁ: SoT soubor s `SECURITY DEFINER`, který v těle volá některou
 * z datových INVOKER funkcí povrchu. Buď je funkce INVOKER, nebo si data musí
 * obstarat sama pod kontrolou nároku — obalit cizí INVOKER a spolehnout se na
 * jeho RLS je právě ta past.
 *
 * Spouští se přes: npm run test:gates -- definer-nesmi-obchazet-invoker
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, 'aisha/db/sql/functions');

/**
 * Datové čtecí RPC povrchu — všechny jsou ZÁMĚRNĚ `SECURITY INVOKER`, protože
 * o viditelnosti má rozhodnout RLS pod identitou volajícího. Obalit je
 * definerem znamená ten záměr zrušit.
 */
const INVOKER_DATA_RPCS = [
  'get_block_data',
  'get_surface_layout',
  'list_surface_sections',
  'get_document_register',
  'get_obligation_queue',
  'get_evidence_findings',
  'get_finding_questions',
  'get_twin_register',
];

/** Odstraní SQL komentáře — brána nesmí padat na příkladu v dokumentaci. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

describe('SECURITY DEFINER nesmí obalit datovou INVOKER funkci', () => {
  const files = existsSync(FUNCTIONS_DIR)
    ? readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith('.sql'))
    : [];

  test('měřidlo má co měřit (SoT funkce existují)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  const offenders: string[] = [];
  for (const file of files) {
    const sql = stripComments(readFileSync(join(FUNCTIONS_DIR, file), 'utf8'));
    if (!/security\s+definer/i.test(sql)) continue;
    // Jméno samotné funkce vyloučit — soubor get_block_data.sql se na sebe odkazuje.
    const own = file.replace(/\.sql$/, '');
    for (const rpc of INVOKER_DATA_RPCS) {
      if (rpc === own) continue;
      // volání = jméno následované '(' (ne jen zmínka v textu)
      if (new RegExp(`\\b${rpc}\\s*\\(`, 'i').test(sql)) {
        offenders.push(`${file} → ${rpc}()`);
      }
    }
  }

  test('žádná SoT definer funkce nevolá datovou INVOKER RPC', () => {
    expect(
      offenders,
      `SECURITY DEFINER funkce volá datovou INVOKER RPC. Ta pak běží pod právy ` +
        `VLASTNÍKA (superuser, RLS bypass), ne volajícího — a nárok se neuplatní. ` +
        `Změřeno 2026-07-31 na produkci: assemble_surface_traced vydala uživateli ` +
        `bez rolí 631 kB (500 dokladů, 509 závazků, 164 nálezů), které mu tytéž ` +
        `bloky přes get_block_data správně odepřely. Buď udělej funkci INVOKER, ` +
        `nebo si data obstarej sama pod kontrolou nároku. Nalezeno: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});

describe('Datové RPC povrchu zůstávají INVOKER', () => {
  // Druhá strana téže mince: kdyby se některé z těchto RPC přepnulo na DEFINER,
  // obešlo by RLS rovnou, bez obalu. pd_review/pd_recommend přesně tak unikaly
  // (get_twin_ref_review_block + get_doc_expiry_review_block byly DEFINER
  // s guardem `auth.uid() is null`, tedy pouhým přihlášením).
  const MUST_BE_INVOKER = [
    'get_block_data',
    'get_document_register',
    'get_obligation_queue',
    'get_twin_register',
    'get_twin_ref_review_block',
    'get_doc_expiry_review_block',
  ];

  for (const fn of MUST_BE_INVOKER) {
    const path = join(FUNCTIONS_DIR, `${fn}.sql`);
    if (!existsSync(path)) continue;
    test(`${fn} je SECURITY INVOKER`, () => {
      const sql = stripComments(readFileSync(path, 'utf8'));
      expect(
        /security\s+definer/i.test(sql),
        `${fn}.sql je SECURITY DEFINER — datové RPC povrchu musí být INVOKER, ` +
          `jinak obejde RLS a nárok se neuplatní (pd_review vracel uživateli bez ` +
          `rolí 14 položek s reálnými protistranami).`
      ).toBe(false);
    });
  }
});
