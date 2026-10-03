import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Verdikt má JEDNOHO vlastníka (scripts/db/lib/pgtap-fixture-seed-kolize.mjs);
// brána ho jen čte a sonduje. Čte soubory in-process — žádný podproces.
import {
  ROOT,
  najdiKolize,
  zmerKolize,
  uniqueKeys,
  pgtapFiles,
  seedFiles,
  extractInserts,
} from '../../../scripts/db/lib/pgtap-fixture-seed-kolize.mjs';

/**
 * Brána: fixture pgTAP schema testu NEKOLIDUJE se seedem na jedinečném klíči —
 * test měří totéž nad DB se seedem i bez něj.
 *
 * ⛔ NAMĚŘENO 2026-09-13: `aisha/db/tests/schema/25_acs_core.sql` vkládal fixture
 * `acs_message_schemas('acs.task.assign@1.0')`, které nese i seed. Nad DB se seedem
 * (`node scripts/db/with-throwaway-db.mjs -- node scripts/db/run-schema-tests.mjs`)
 * padal `duplicate key value violates unique constraint "acs_message_schemas_pkey"`;
 * v CI (verify-cold-start-apply.sh: baseline + heals, BEZ seedu) procházel. CI tu
 * závislost z principu nevidí — seed nikdy nepouští —, proto ji měří tahle brána
 * staticky, bez DB.
 *
 * Totéž měření našlo dalších 18 „tichých" kolizí (`ON CONFLICT … DO NOTHING` na
 * `supported_languages` global/cs/en v 11 souborech a `system_config.commerce_base_currency`):
 * nad seedem nepadnou, ale nechají v tabulce SEEDOVÝ řádek (jiné is_default,
 * name_native) — test pak běží nad daty, která nevložil. Vlastnost proto zní:
 * kolize je přípustná JEN když fixture deterministicky vyhrává
 * (`ON CONFLICT (<klíč>) DO UPDATE SET <každý deklarovaný sloupec> = EXCLUDED.<sloupec>`).
 *
 * Vesmír je ODVOZENÝ, ne vyjmenovaný: všechny `aisha/db/tests/schema/**.sql`, seed
 * = `seed.compiled.sql` + zdroje VŠECH profilů `aisha/db/seed/**`, jedinečné klíče =
 * PRIMARY KEY / UNIQUE / CREATE UNIQUE INDEX z `aisha/db/sql/**` + substrátu.
 * Co staticky změřit nejde (seed přes INSERT … SELECT, výrazový index, tabulka bez
 * klíče v SoT), je PORUŠENÍ, ne zelená: brána nesmí být zelená proto, že neviděla.
 */

const HISTORICKA_FIXTURE_25 = `INSERT INTO acs_message_schemas (schema_ref, json_schema, semantics, mode)
  VALUES ('acs.task.assign@1.0', '{}'::jsonb, 'test', 'shadow');`;

const klice = uniqueKeys();
const seedy = seedFiles().map((f: string) => ({ jmeno: f.slice(ROOT.length + 1), sql: readFileSync(f, 'utf8') }));
const sonda = (testSql: string, seedSql?: string) =>
  zmerKolize({
    testy: [{ jmeno: 'sonda.sql', sql: testSql }],
    seedy: seedSql === undefined ? seedy : [{ jmeno: 'seed-sonda.sql', sql: seedSql }],
    klice,
  });

describe('pgTAP fixture nekoliduje se seedem', () => {
  it('vesmír je neprázdný a odvozený (testy, seed, klíče) — brána nesmí být zelená z nevidění', () => {
    const testy = pgtapFiles().map((f: string) => f.slice(ROOT.length + 1));
    expect(testy).toContain('aisha/db/tests/schema/25_acs_core.sql');
    expect(testy.length).toBeGreaterThan(30);
    expect(seedy.map((s) => s.jmeno)).toContain('aisha/db/seed.compiled.sql');
    // klíč se čte ze SoT schématu, ne ze seznamu v bráně
    expect(klice.keys.get('acs_message_schemas')?.map((k: { columns: string[] }) => k.columns.join(','))).toContain('schema_ref');
    expect(klice.keys.get('supported_languages')?.map((k: { columns: string[] }) => k.columns.join(','))).toContain('code');
    expect(klice.keys.get('aisha_auth.users')?.map((k: { columns: string[] }) => k.columns.join(','))).toContain('id');
  });

  it('žádná fixture nekoliduje se seedem; co nejde změřit, je porušení', () => {
    const { kolize, nemeritelne, mereno } = najdiKolize();
    const popis = [
      ...kolize.map(
        (k: { test: string; line: number; table: string; key: string[]; values: string[]; druh: string; seed: string; seedLine: number }) =>
          `${k.test}:${k.line} ${k.table}(${k.key.join(',')})=${JSON.stringify(k.values)} — ${
            k.druh === 'tvrda'
              ? 'bez ON CONFLICT: nad seedem 23505'
              : 'ON CONFLICT, ale fixture nevyhrává: nad seedem test tiše běží nad SEEDOVÝM řádkem'
          } (seed ${k.seed}:${k.seedLine}). Oprava: klíč vlastní testu, nebo ON CONFLICT (${k.key.join(', ')}) DO UPDATE SET <každý deklarovaný sloupec> = EXCLUDED.<sloupec>`,
      ),
      ...nemeritelne.map((n: { test: string; line: number; proc: string }) => `${n.test}:${n.line} NEMĚŘITELNÉ — ${n.proc}`),
    ];
    expect(popis, popis.join('\n')).toEqual([]);
    // měření opravdu proběhlo (literální fixture × klíč), ne prázdná smyčka
    expect(mereno).toBeGreaterThan(20);
  });

  // ── negativní sondy: detektor musí vidět každou známou podobu vady ──────────

  it('sonda: historická fixture 25_acs_core proti SKUTEČNÉMU seedu = tvrdá kolize', () => {
    const r = sonda(HISTORICKA_FIXTURE_25);
    expect(r.kolize.map((k: { table: string; druh: string; values: string[] }) => [k.table, k.druh, k.values])).toEqual([
      ['acs_message_schemas', 'tvrda', ['acs.task.assign@1.0']],
    ]);
  });

  it('sonda: ON CONFLICT DO NOTHING nad seedovým klíčem = tichá kolize', () => {
    const r = sonda(`INSERT INTO supported_languages (code, name_native) VALUES ('cs', 'Cestina') ON CONFLICT (code) DO NOTHING;`);
    expect(r.kolize.map((k: { druh: string }) => k.druh)).toEqual(['ticha']);
  });

  it('sonda: DO UPDATE, který nepřepíše všechny deklarované sloupce = tichá kolize', () => {
    const r = sonda(
      `INSERT INTO supported_languages (code, name_native, is_default) VALUES ('cs', 'X', true)
       ON CONFLICT (code) DO UPDATE SET name_native = EXCLUDED.name_native;`,
    );
    expect(r.kolize.map((k: { druh: string }) => k.druh)).toEqual(['ticha']);
    const jinyCil = sonda(
      `INSERT INTO system_config (key, value) VALUES ('commerce_base_currency', '"EUR"')
       ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value;`,
    );
    expect(jinyCil.kolize.map((k: { druh: string }) => k.druh)).toEqual(['ticha']);
  });

  it('sonda: fixture, která vyhrává (DO UPDATE přes všechny deklarované sloupce), kolizí není', () => {
    const r = sonda(
      `INSERT INTO supported_languages (code, name_native, is_default) VALUES ('cs', 'X', true)
       ON CONFLICT (code) DO UPDATE SET name_native = EXCLUDED.name_native, is_default = excluded.is_default;`,
    );
    expect(r.kolize).toEqual([]);
    expect(r.prijate.length).toBe(1);
  });

  it('sonda: klíč schovaný za set_config/current_setting, v $$ bloku i v DECLARE proměnné je vidět', () => {
    const seed = `INSERT INTO acs_message_schemas (schema_ref, json_schema) VALUES ('a.b@1.0', '{}');`;
    const zaSettingem = sonda(
      `SELECT set_config('t.s', 'a.b@1.0', true);
       INSERT INTO acs_message_schemas (schema_ref, json_schema) VALUES (current_setting('t.s'), '{}'::jsonb);`,
      seed,
    );
    expect(zaSettingem.kolize.length).toBe(1);
    const vThrowsOk = sonda(
      `SELECT throws_ok($$ INSERT INTO acs_message_schemas (schema_ref, json_schema) VALUES ('a.b@1.0', 'x') $$, '23514');`,
      seed,
    );
    expect(vThrowsOk.kolize.length).toBe(1);
    const vDeclare = sonda(
      `DO $blk$ DECLARE v_ref text := 'a.b@1.0'; BEGIN
         INSERT INTO acs_message_schemas (schema_ref, json_schema) VALUES (v_ref, '{}');
       END $blk$;`,
      seed,
    );
    expect(vDeclare.kolize.length).toBe(1);
  });

  it('sonda: per-běh náhodný klíč (gen_random_uuid) kolizí není; NULL v klíči také ne', () => {
    const r = sonda(
      `SELECT set_config('t.id', gen_random_uuid()::text, true);
       INSERT INTO system_config (id, key, value) VALUES (current_setting('t.id')::uuid, NULL, '1');`,
    );
    expect(r.kolize).toEqual([]);
  });

  it('sonda: seed plnící tabulku přes INSERT … SELECT nelze staticky vyloučit → neměřitelné, ne zelené', () => {
    const r = sonda(
      `INSERT INTO acs_message_schemas (schema_ref, json_schema) VALUES ('c.d@1.0', '{}');`,
      `INSERT INTO acs_message_schemas (schema_ref, json_schema) SELECT ref, '{}' FROM zdroj;`,
    );
    expect(r.kolize).toEqual([]);
    expect(r.nemeritelne.length).toBe(1);
  });

  it('sonda: dolarový řetězec s čárkami v seedu nerozhodí n-tici (čárka v JSONu není oddělovač)', () => {
    const ins = extractInserts(
      `INSERT INTO t (a, b, c) VALUES ('x', $json$ {"p": [1, 2, 3], "q": "don't"} $json$, 'z');`,
    );
    expect(ins[0].rows[0].length).toBe(3);
    expect(ins[0].rows[0][2]).toBe(`'z'`);
  });

  it('opravený 25_acs_core nese vlastní schema_ref, žádný seed ho nenese', () => {
    const sql = readFileSync(join(ROOT, 'aisha/db/tests/schema/25_acs_core.sql'), 'utf8');
    const fixture = extractInserts(sql).filter((i: { table: string }) => i.table === 'acs_message_schemas');
    expect(fixture.length).toBe(1);
    const r = sonda(sql);
    expect(r.kolize).toEqual([]);
    expect(r.prijate).toEqual([]); // ne „vyhrává nad seedem", ale vůbec nesdílí klíč
  });
});
