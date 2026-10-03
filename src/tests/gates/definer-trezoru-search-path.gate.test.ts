/**
 * Definer funkce trezoru a tajemství: `search_path` = 'pg_catalog', 'public', 'pg_temp' (pg_temp POSLEDNÍ).
 *
 * ⛔ Proč (rada d8, 27. 9.; převzato z forku): SECURITY DEFINER běží s právy vlastníka. S prostým
 * `SET search_path TO 'public'` se schéma dočasných objektů relace (`pg_temp`) prohledává PRVNÍ
 * pro relace a operátory — relace, která smí vytvářet dočasné tabulky, podstrčí vlastní objekt
 * stejného jména. U funkcí, které drží šifrový text tokenů uživatelů (trezor relací federace)
 * nebo klíče šifrování a trezoru platformy, je to nejcitlivější místo v DB. Výslovné
 * `pg_catalog` první a `pg_temp` poslední tuhle cestu zavírá (doporučený tvar PostgreSQL).
 *
 * Třída (odvozená ze jmen souborů, ne vypsaná rukou po funkcích):
 *   trezor relací federace  — federated_source_session_*, federated_flow_nonce*, enforce_rate_limit_for,
 *                             cleanup_old_rate_limits (PR A #1078);
 *   tajemství platformy      — aisha_column_encryption_key, aisha_vault_encryption_key,
 *                             vault_create_secret, vault_update_secret (#1080).
 *
 * Spouští se přes: npm run test:gates -- definer-trezoru-search-path
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sqlBezKomentaru } from "../lib/bez-komentaru";

const ROOT = process.cwd();
const FUNKCE = join(ROOT, "aisha/db/sql/functions");
const TRIDA =
  /^(federated_source_session_[a-z_]+|federated_flow_nonces?_[a-z_]+|enforce_rate_limit_for|cleanup_old_rate_limits|aisha_(column|vault)_encryption_key|vault_(create|update)_secret)\.sql$/;
const ZPEVNENY = /SET\s+search_path\s+TO\s+'pg_catalog'\s*,\s*'public'\s*,\s*'pg_temp'\s*(\n|$)/i;

/** Nález pro jeden soubor třídy: null = v pořádku, jinak důvod. */
export function nalez(sqlSKomentari: string): string | null {
  const sql = sqlBezKomentaru(sqlSKomentari);
  if (!/SECURITY\s+DEFINER/i.test(sql)) return "není SECURITY DEFINER (třída je jen definer)";
  const radky = sql.match(/SET\s+search_path[^\n]*/gi) ?? [];
  if (radky.length !== 1) return `search_path deklarován ${radky.length}× (čekán přesně 1)`;
  if (!ZPEVNENY.test(`${radky[0]}\n`)) return `tvar „${radky[0].trim()}" ≠ 'pg_catalog', 'public', 'pg_temp'`;
  return null;
}

const soubory = readdirSync(FUNKCE).filter((f) => TRIDA.test(f)).sort();

describe("definer funkce trezoru a tajemství: search_path pg_catalog, public, pg_temp", () => {
  it("třída není prázdná a nese obě rodiny (kotva: brána nad ničím je horší než žádná)", () => {
    expect(soubory.length).toBeGreaterThanOrEqual(15);
    expect(soubory).toContain("federated_source_session_put.sql");
    expect(soubory).toContain("vault_create_secret.sql");
  });

  it("každá funkce třídy má přesně zpevněný tvar (pg_temp poslední)", () => {
    const vady = soubory
      .map((f) => [f, nalez(readFileSync(join(FUNKCE, f), "utf8"))] as const)
      .filter(([, v]) => v !== null)
      .map(([f, v]) => `${f}: ${v}`);
    expect(vady).toEqual([]);
  });

  describe("negativní sondy: vadný tvar MUSÍ být nález", () => {
    const telo = (sp: string) =>
      `CREATE OR REPLACE FUNCTION public.x() RETURNS void LANGUAGE plpgsql SECURITY DEFINER\n${sp}\nAS $$ BEGIN END; $$;`;
    it("jen 'public' (pg_temp se hledá první)", () => {
      expect(nalez(telo("SET search_path TO 'public'"))).not.toBeNull();
    });
    it("bez pg_temp na konci", () => {
      expect(nalez(telo("SET search_path TO 'pg_catalog', 'public'"))).not.toBeNull();
    });
    it("pg_temp jinde než na konci", () => {
      expect(nalez(telo("SET search_path TO 'pg_temp', 'pg_catalog', 'public'"))).not.toBeNull();
      expect(nalez(telo("SET search_path TO 'pg_catalog', 'pg_temp', 'public'"))).not.toBeNull();
    });
    it("tvar jen v komentáři se nepočítá", () => {
      expect(nalez(telo("-- SET search_path TO 'pg_catalog', 'public', 'pg_temp'\nSET search_path TO 'public'"))).not.toBeNull();
    });
    it("kotva: zpevněný tvar projde (i s komentářem na konci řádku)", () => {
      expect(nalez(telo("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"))).toBeNull();
      expect(nalez(telo("SET search_path TO 'pg_catalog', 'public', 'pg_temp'  -- vše kvalifikované"))).toBeNull();
    });
  });
});
