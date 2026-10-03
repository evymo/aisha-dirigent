/**
 * Predikáty nároku mají v DATABÁZI výchozí COST — ne jen v SoT.
 *
 * Brána `predikat-naroku-vychozi-cost` čte zdrojové soubory; tenhle test čte pg_proc.
 * Rozdíl je podstatný: kolo 13 zapsalo `COST 100000` do živé databáze a oprava ho
 * odstraňuje tím, že `CREATE OR REPLACE` klauzuli COST vůbec neuvede. Že to opravdu
 * vrátí výchozí hodnotu (a nezachová starou), je tvrzení o Postgresu — a to se měří.
 *
 * Proč na tom záleží (naměřeno 2026-09-30 na produkci): cenu restrikční podmínky
 * planner účtuje za každý proskenovaný řádek; s COST 100000 by `get_kiosk_rozvozy`
 * dostal odhad +30,8 mil. a při každém volání tabletu kompiloval plný JIT.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();

/** Řádkové predikáty nároku — volají se ve WHERE nad celými tabulkami. */
const PREDIKATY = [
  "workflow_step_visible_to",
  "document_visible_to",
  "has_role",
  "is_admin_or_staff",
  "is_service_role",
  "surface_audience_allows",
];

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { encoding: "utf8", input: `${sql};`, env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  ).trim();
}

describe.skipIf(!dbAvailable)("predikáty nároku mají výchozí COST v databázi", () => {
  it("každý predikát existuje (jinak by test měřil nad ničím)", () => {
    const n = psql(
      `SELECT count(DISTINCT proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname IN (${PREDIKATY.map((p) => `'${p}'`).join(",")})`,
    );
    expect(Number(n)).toBe(PREDIKATY.length);
  });

  it("žádný nemá procost nad výchozí hodnotou (plpgsql/sql = 100)", () => {
    const radky = psql(
      `SELECT p.oid::regprocedure || '=' || p.procost FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN (${PREDIKATY.map((x) => `'${x}'`).join(",")})
          AND p.procost > 100
        ORDER BY 1`,
    );
    expect(radky === "" ? [] : radky.split("\n")).toEqual([]);
  });

  it("CREATE OR REPLACE bez klauzule COST vrací výchozí hodnotu (vlastnost Postgresu, změřená)", () => {
    const vysledek = psql(`
      BEGIN;
      CREATE FUNCTION pg_temp.zz_cost_probe() RETURNS boolean LANGUAGE sql STABLE COST 100000 AS $$ select true $$;
      CREATE OR REPLACE FUNCTION pg_temp.zz_cost_probe() RETURNS boolean LANGUAGE sql STABLE AS $$ select true $$;
      SELECT procost FROM pg_proc WHERE proname = 'zz_cost_probe';
      ROLLBACK`);
    expect(vysledek.split("\n").filter((l) => /^\d/.test(l))).toEqual(["100"]);
  });
});
