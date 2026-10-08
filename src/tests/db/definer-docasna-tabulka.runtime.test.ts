/**
 * Definer funkce nepřevezme dočasnou tabulku, kterou si volající založil předem — CHOVÁNÍ.
 *
 * ⛔ Tři funkce SECURITY DEFINER zakládaly pracovní tabulku přes
 * `CREATE TEMPORARY TABLE IF NOT EXISTS x`. Kdo funkci smí zavolat, mohl si `x`
 * založit v relaci předem: funkce pak četla JEHO řádky (u srovnání s doklady tedy
 * podvrženou „pravdu“, podle které uzavírá kroky) a jeho spouště by běžely právy
 * vlastníka funkce. Bezpečný tvar: `DROP TABLE IF EXISTS pg_temp.x` → založit znovu →
 * číst jen jako `pg_temp.x`. Tvar hlídá brána `definer-search-path`; tady se měří,
 * že funkce podvrženou tabulku opravdu ZAHODÍ.
 *
 * Volá se jako service_role v jedné transakci, která se vrátí — v databázi nic nezůstane.
 *
 * Spouští se přes: npm run test:db:docasna-tabulka (throwaway DB z baseline + heals)
 */
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA", "-q"],
    { input: sql, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

/** Pod service_role: podvržená tabulka se značkou → volání funkce → co z podvrhu zbylo. */
function poVolani(tabulka: string, sloupce: string, radek: string, volani: string): { vysledek: string; zbylo: string } {
  const out = psql(`
BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL ROLE service_role;
CREATE TEMPORARY TABLE ${tabulka} (${sloupce}) ON COMMIT DROP;
INSERT INTO ${tabulka} VALUES (${radek});
SELECT 'vysledek=' || (${volani})::text;
RESET ROLE; -- tabulku založenou funkcí vlastní její vlastník; co zbylo, čte superuživatel relace
SELECT 'zbylo=' || (SELECT count(*) FROM pg_temp.${tabulka} WHERE ${sloupce.split(" ")[0]}::text = (ARRAY[${radek}])[1]::text);
ROLLBACK;`);
  const najdi = (k: string) => out.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? "";
  return { vysledek: najdi("vysledek"), zbylo: najdi("zbylo") };
}

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("definer funkce nepřevezme dočasnou tabulku volajícího", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    }
  });

  it("kontrolní vzorek: service_role si dočasnou tabulku založit SMÍ (jinak by test měřil nic)", () => {
    const out = psql(`BEGIN; SET LOCAL ROLE service_role; CREATE TEMPORARY TABLE _zk_vzorek (a int) ON COMMIT DROP; SELECT count(*) FROM pg_temp._zk_vzorek; ROLLBACK;`);
    expect(out).toBe("0");
  });

  it("srovnání kroků s doklady: podvržená „pravda dokladu“ je po volání pryč", () => {
    const r = poVolani("_pravda_dokladu", "dl text, settled text", "'PODVRH-ZKOUSKA', 'True'", "public.reconcile_workflow_from_documents(true)");
    expect(JSON.parse(r.vysledek)).toMatchObject({ ok: true, dry_run: true });
    expect(r.zbylo, "funkce četla tabulku volajícího — podvržený řádek v ní zůstal").toBe("0");
  });

  it("uzávěrka starých běhů: podvržený seznam běhů je po volání pryč", () => {
    const r = poVolani(
      "_stare_behy",
      "batch_id uuid PRIMARY KEY",
      "'00000000-0000-4000-8000-00000000dead'",
      "public.close_stale_workflow_runs_admin('sablona-ktera-neexistuje', current_date - 1, 'krok-zkouska', 'zkouška dočasné tabulky', true)",
    );
    expect(JSON.parse(r.vysledek)).toMatchObject({ ok: true });
    expect(r.zbylo, "funkce pracovala s tabulkou volajícího — podvržený běh v ní zůstal").toBe("0");
  });
});
