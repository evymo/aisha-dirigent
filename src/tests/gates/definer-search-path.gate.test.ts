/**
 * Brána: funkce SECURITY DEFINER × search_path — nic nového, staré ubývá
 *
 * ⛔ ZMĚŘENO 2026-10-03: z 1 649 funkcí SECURITY DEFINER jmenuje `pg_temp` v cestě
 * jen 122. Funkce běží právy vlastníka (superuživatele) a dvě cesty, jak jí
 * podstrčit cizí objekt, nehlídal nikdo mimo úzkou třídu trezoru
 * (`definer-trezoru-search-path`):
 *
 *   STÍNĚNÍ — bez `pg_temp` v cestě ho PostgreSQL pro relace a typy prohledá první;
 *   nekvalifikovaný odkaz jde přesměrovat dočasným objektem volajícího.
 *   PŘETÍŽENÍ — volání funkce instance bez schématu najde přetížení od kohokoli,
 *   kdo smí vytvářet ve schématu na cestě.
 *   DOČASNÁ TABULKA — `CREATE TEMPORARY TABLE IF NOT EXISTS` převezme tabulku, kterou
 *   si volající založil předem, i s jejími spouštěmi.
 *
 * RÁČNA, NE ALLOWLIST: snímek dluhu (jména funkcí) smí jen klesat. Nová funkce do něj
 * nepatří — má mít `SET search_path TO 'pg_catalog', 'public', 'pg_temp'` a volání
 * funkcí instance se schématem. Funkce, která z dluhu vypadla nebo zmizela, se ze
 * snímku musí smazat (`node scripts/gen-definer-search-path-baseline.mjs`).
 *
 * Měřák: scripts/lib/definer-search-path.mjs (vlastní testy tvarů vedle něj).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rozborDefineru, slovnikZdroje, zmerDefinery } from "../../../scripts/lib/definer-search-path.mjs";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "src/tests/gates/definer-search-path.baseline.json");

type Snimek = { stinitelne: string[]; volani_bez_schematu: string[]; docasne_tabulky: string[]; nerozebrano: string[] };

function nactiSnimek(): Snimek {
  if (!existsSync(BASELINE)) {
    throw new Error(`Snímek chybí: ${BASELINE} — bez něj brána nemá co porovnávat. Vygeneruj: node scripts/gen-definer-search-path-baseline.mjs`);
  }
  return JSON.parse(readFileSync(BASELINE, "utf-8")) as Snimek;
}

const NAPRAVA =
  "Náprava: `SET search_path TO 'pg_catalog', 'public', 'pg_temp'` (pg_temp POSLEDNÍ) a odkazy se schématem " +
  "(`public.tabulka`, `public.funkce()`). Do snímku dluhu se nová funkce NEPŘIDÁVÁ.";

describe("funkce SECURITY DEFINER × search_path: nic nového, staré ubývá", () => {
  const snimek = nactiSnimek();
  const ted = zmerDefinery(ROOT);
  const rady: [keyof Snimek, string[], string][] = [
    ["stinitelne", ted.stinitelne, "nekvalifikovaný odkaz na relaci nebo typ bez `pg_temp` na konci cesty"],
    ["volani_bez_schematu", ted.volaniBezSchematu, "volání funkce instance bez schématu"],
    ["docasne_tabulky", ted.docasne, "dočasná tabulka převzatelná od volajícího (IF NOT EXISTS / odkaz bez `pg_temp.`)"],
    ["nerozebrano", ted.nerozebrano, "definer bez dolarového těla — měřák ji neumí rozebrat, není to „čisto“"],
  ];

  it("měřák má co měřit a pozná zpevněnou funkci od nezpevněné (kotva)", () => {
    expect(ted.definery, "žádné definer funkce — měřák by byl zelený nad ničím").toBeGreaterThan(1000);
    expect(ted.slovnik.relace).toBeGreaterThan(100);
    expect(ted.sTemp, "žádná funkce s pg_temp na konci cesty — kotva zpevněného tvaru chybí").toBeGreaterThan(0);
    const slovnik = slovnikZdroje(ROOT);
    const tabulka = [...slovnik.relace][0];
    const fn = (cesta: string) =>
      `CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\nSET search_path TO ${cesta}\nAS $$ BEGIN PERFORM 1 FROM ${tabulka}; END $$;`;
    expect(rozborDefineru(fn("'public'"), slovnik)).toMatchObject({ stinitelna: true });
    expect(rozborDefineru(fn("'pg_catalog', 'public', 'pg_temp'"), slovnik)).toMatchObject({ stinitelna: false });
  });

  for (const [klic, nyni, co] of rady) {
    it(`${klic}: žádná funkce mimo snímek (${nyni.length} dnes, ${snimek[klic].length} ve snímku)`, () => {
      const znamy = new Set(snimek[klic]);
      expect(
        nyni.filter((j) => !znamy.has(j)),
        `Nová nebo změněná funkce má ${co}.\n${NAPRAVA}`,
      ).toEqual([]);
    });

    it(`${klic}: snímek nezvětral — co v něm je, pořád v dluhu je`, () => {
      const dnes = new Set(nyni);
      expect(
        snimek[klic].filter((j) => !dnes.has(j)),
        "Funkce z dluhu vypadla nebo zmizela — smaž ji ze snímku: node scripts/gen-definer-search-path-baseline.mjs",
      ).toEqual([]);
    });
  }

  it("snímek nemá duplicity a je seřazený (rozdíl v revizi má být čitelný)", () => {
    for (const [klic] of rady) {
      const s = snimek[klic];
      expect(new Set(s).size, `${klic}: duplicity`).toBe(s.length);
      expect([...s].sort(), `${klic}: neseřazeno`).toEqual(s);
    }
  });
});
