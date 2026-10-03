/**
 * Sekvence nesmí zaostávat za daty — po baseline + heals + seedu.
 *
 * ⛔ NAMĚŘENO 2026-09-14: seed vkládal delivery_transition_rules s pevnými id
 * (až 729) a sekvenci neposunul. Na každé čistě nasazené instanci pak první
 * INSERT bez id (admin, migrace, test) spadl na delivery_transition_rules_pkey.
 * Statický sken seedu tu třídu nevidí celou: sekvence se dá rozjet i heals
 * blokem, instančním overlayem nebo sekvencí bez OWNED BY — a tam
 * pg_get_serial_sequence() vrací NULL, takže i „oprava" přes ni potichu nic
 * neudělá. Ptáme se proto živé DB.
 *
 * Pro KAŽDÝ sloupec, jehož default je nextval(…) nebo který je IDENTITY:
 *   další hodnota sekvence (last_value + increment, u nevolané start_value)
 *   musí být větší než max(sloupec).
 *
 * ⛔ KONTROLNÍ VZOREK: dočasná tabulka se serial sloupcem a řádkem s pevným id
 * musí být nalezena — jinak by prázdný nález znamenal slepý dotaz, ne zdravou DB.
 *
 * Spouští se přes: npm run test:db:sekvence (throwaway DB se seedem)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();

type Nalez = { sloupec: string; sekvence: string; dalsi: number; max: number };

/**
 * Najde sloupce se sekvencí (nextval default i identity) ve všech ne-systémových
 * schématech a vrátí ty, kde další hodnota sekvence ≤ max(sloupec).
 */
const DOTAZ = `
DO $$
DECLARE
  r record;
  v_max bigint;
  v_dalsi bigint;
  v_nalezy jsonb := '[]'::jsonb;
  v_zkontrolovano int := 0;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema, c.relname AS tabulka, a.attname AS sloupec,
           COALESCE(
             pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname)::regclass,
             substring(pg_get_expr(d.adbin, d.adrelid) FROM $re$nextval\\('([^']+)'$re$)::regclass
           ) AS sekvence
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p')
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND (n.nspname NOT LIKE 'pg_temp%' OR n.oid = pg_my_temp_schema())
  LOOP
    CONTINUE WHEN r.sekvence IS NULL;
    v_zkontrolovano := v_zkontrolovano + 1;
    EXECUTE format('SELECT max(%I)::bigint FROM %I.%I', r.sloupec, r.schema, r.tabulka) INTO v_max;
    CONTINUE WHEN v_max IS NULL;
    SELECT CASE WHEN s.last_value IS NULL THEN s.start_value ELSE s.last_value + s.increment_by END
      INTO v_dalsi
      FROM pg_sequences s
      WHERE format('%I.%I', s.schemaname, s.sequencename)::regclass = r.sekvence;
    IF v_dalsi <= v_max THEN
      v_nalezy := v_nalezy || jsonb_build_object(
        'sloupec', format('%s.%s.%s', r.schema, r.tabulka, r.sloupec),
        'sekvence', r.sekvence::text, 'dalsi', v_dalsi, 'max', v_max);
    END IF;
  END LOOP;
  INSERT INTO pg_temp.sekvence_vysledek VALUES (jsonb_build_object('zkontrolovano', v_zkontrolovano, 'nalezy', v_nalezy));
END $$;`;

function zmer(sKontrolnimVzorkem: boolean): { zkontrolovano: number; nalezy: Nalez[] } {
  const vzorek = sKontrolnimVzorkem
    ? `CREATE TEMP TABLE sekvence_vzorek (id serial PRIMARY KEY, x text);
       INSERT INTO sekvence_vzorek (id, x) VALUES (5, 'pevné id');`
    : "";
  const vystup = psqlMultiline(`
\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE sekvence_vysledek (v jsonb);
${vzorek}
${DOTAZ}
\\t on
\\a on
SELECT 'SEKVENCE=' || v::text FROM pg_temp.sekvence_vysledek;
ROLLBACK;
`);
  const radek = vystup.split("\n").find((l) => l.startsWith("SEKVENCE="));
  if (!radek) throw new Error(`měření nevrátilo výsledek — výstup psql:\n${vystup}`);
  return JSON.parse(radek.slice("SEKVENCE=".length));
}

let zdrava: { zkontrolovano: number; nalezy: Nalez[] };
let sVzorkem: { zkontrolovano: number; nalezy: Nalez[] };

beforeAll(() => {
  if (!dbAvailable) return;
  sVzorkem = zmer(true);
  zdrava = zmer(false);
}, 120_000);

describe.skipIf(!dbAvailable)("sekvence nezaostávají za daty (runtime)", () => {
  it("kontrolní vzorek: serial sloupec s pevným id nad sekvencí je nalezen", () => {
    expect(sVzorkem.nalezy.map((n) => n.sloupec)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.sekvence_vzorek\.id$/)]),
    );
  });

  it("měření vidí sloupce se sekvencí (jinak by prázdný nález nic neznamenal)", () => {
    expect(zdrava.zkontrolovano).toBeGreaterThanOrEqual(5);
  });

  it("žádná sekvence po seedu nezaostává za max(id)", () => {
    expect(
      zdrava.nalezy,
      "Sekvence vrátí id, které už existuje → první INSERT bez id spadne na pkey.\n" +
        "Po vložení s pevnými id posuň sekvenci: setval('<schema>.<seq>'::regclass, max(id)).",
    ).toEqual([]);
  });

  /**
   * Běžící instance dostaly starý seed — rozjetou sekvenci jim dorovná jen heals.
   * Na čisté throwaway DB to vidět není (heals běží PŘED seedem), proto se tu
   * sekvence nejdřív vrátí na začátek (stav živé instance) a pak se spustí
   * přesně ten blok z heals.sql. ⚠ setval není transakční — test běží poslední.
   */
  it("heals blok dorovná sekvenci na instanci, která dostala starý seed", () => {
    const heals = readFileSync(join(process.cwd(), "aisha/db/heals.sql"), "utf8");
    const blok = heals.match(/-- >>> sekvence-za-daty\n([\s\S]*?)-- <<< sekvence-za-daty/);
    expect(blok, "blok sekvence-za-daty v heals.sql nenalezen").not.toBeNull();

    psqlMultiline(`\\set ON_ERROR_STOP on
SELECT setval('public.delivery_transition_rules_id_seq'::regclass, 1, false);`);
    expect(zmer(false).nalezy.map((n) => n.sloupec), "rozjetí se nepovedlo — test by nic neměřil").toContain(
      "public.delivery_transition_rules.id",
    );

    psqlMultiline(`\\set ON_ERROR_STOP on\n${blok![1]}`);
    expect(zmer(false).nalezy).toEqual([]);

    // Idempotence: druhý běh heals nesmí sekvenci posunout dál ani vrátit zpět.
    const pred = psqlMultiline(`\\t on\n\\a on\nSELECT 'LAST=' || last_value FROM pg_sequences WHERE sequencename = 'delivery_transition_rules_id_seq';`);
    psqlMultiline(`\\set ON_ERROR_STOP on\n${blok![1]}`);
    const po = psqlMultiline(`\\t on\n\\a on\nSELECT 'LAST=' || last_value FROM pg_sequences WHERE sequencename = 'delivery_transition_rules_id_seq';`);
    expect(po.match(/LAST=\d+/)?.[0]).toBe(pred.match(/LAST=\d+/)?.[0]);
  });
});
