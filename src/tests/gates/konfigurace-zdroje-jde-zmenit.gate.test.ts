import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Konfiguraci zdroje musí jít ZMĚNIT — a překlep se musí ozvat.
 *
 * ⛔ PROČ EXISTUJE
 * Naměřeno 2026-09-01: systém uměl zdroj ZALOŽIT s konfigurací
 * (`materialize_data_source`) i zapnout a vypnout, ale ZMĚNIT ji ne. Faktury
 * se z ERP netahaly, protože zdroj měl v `doc_markers` jediný marker, zatímco
 * mapy pro obě faktury ležely v instančním bundlu hotové. Změna na dva řádky
 * se musela udělat přímým UPDATEm do databáze a zápis do žurnálu dopsat ručně.
 * Vznik měl cestu, změna ne — táž asymetrie jako u zapínání.
 *
 * ⭐ MĚŘÍ SE TŘI VLASTNOSTI, ne přítomnost souboru:
 *   1. slučuje (přepis by shodil správu, kterou volající nezmínil)
 *   2. neznámý klíč odmítne (jinak je překlep tichý no-op)
 *   3. tajemství odkáže do šifrované tabulky
 *
 * ⚠️ Brána NEOVĚŘUJE, že marker má v bundlu mapu — mapy nejsou v databázi,
 * takže na ně SQL nedosáhne. To se pozná až spuštěním.
 */
const ROOT = join(__dirname, "../../..");
const SQL = join(ROOT, "aisha/db/sql");
const HEALS = readFileSync(join(ROOT, "aisha/db/heals.sql"), "utf8");
const REL = "functions/set_data_source_config.sql";

describe("konfigurace zdroje jde změnit z administrace", () => {
  it("existuje a je dosažitelná z heals", () => {
    expect(existsSync(join(SQL, REL)), `chybí SoT soubor ${REL}`).toBe(true);
    expect(
      HEALS.includes(`\\ir sql/${REL}`),
      "bez `\\ir` v heals.sql se to na běžící databázi nikdy nepřehraje",
    ).toBe(true);
  });

  it("slučuje, nepřepisuje", () => {
    const src = readFileSync(join(SQL, REL), "utf8");
    expect(src, "config se musí slučovat — přepis shodí správu").toMatch(
      /config\s*=\s*v_config\s*\|\|\s*p_patch/,
    );
  });

  it("neznámý klíč je vada, ne nová vlastnost", () => {
    const src = readFileSync(join(SQL, REL), "utf8");
    expect(src).toMatch(/p_allow_new_keys/);
    expect(src, "překlep musí skončit výjimkou, ne tichým zápisem").toMatch(
      /RAISE EXCEPTION[^;]*nemá klíče/,
    );
  });

  it("tajemství do čitelné config nepustí", () => {
    const src = readFileSync(join(SQL, REL), "utf8");
    expect(src).toMatch(/heslo\|password\|secret\|token/);
    expect(src, "musí odkázat na šifrovanou cestu").toMatch(/set_data_source_secrets/);
  });
});
