/**
 * Brána: datová RPC, která čte osu pohledu „podle firmy“, to OHLÁSÍ.
 *
 * ⛔ NAMĚŘENO 2026-09-28: pohled šel do každého bloku sekce, ale filtrovat uměla jen
 * část RPC — zbytek ukazoval celý podnik a na obrazovce se to od filtrovaného bloku
 * nedalo rozeznat. Klient teď porovná svůj pohled s `provenance.scope_effective`
 * a mlčící blok označí jako nefiltrovaný (workbench-shell `scopeIgnored`).
 *
 * To funguje, jen když filtrující RPC opravdu mluví. Tahle brána hlídá obě strany
 * téhož slibu: RPC, která `owner_company` z p_params ČTE, musí volat
 * `scope_applied(p_params, 'owner_company')`. Nová RPC, která by filtr zapomněla
 * ohlásit, by se jinak zobrazila jako „nefiltruje se“, ačkoli filtruje — a naopak
 * se sem nedá dostat RPC, která hlásí filtr, jejž nečte.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../../../aisha/db/sql/functions");

const CTE = /p_params\s*->>\s*'owner_company'|p_params\s*#>>\s*'\{scope_map,\s*owner_company/;
const HLASI = /scope_applied\s*\(\s*p_params\s*,\s*'owner_company'\s*\)/;

/** Nálezy nad {soubor: obsah}: čte osu a nehlásí ji, nebo hlásí a nečte. */
function nalezy(soubory: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [jmeno, obsah] of Object.entries(soubory)) {
    if (jmeno === "scope_applied.sql") continue;
    // Komentáře se nepočítají: zmínka v próze není čtení ani hlášení.
    const kod = obsah.replace(/--[^\n]*/g, "");
    const cte = CTE.test(kod);
    const hlasi = HLASI.test(kod);
    if (cte && !hlasi) out.push(`${jmeno}: čte owner_company z p_params, ale neohlásí scope_applied`);
    if (hlasi && !cte) out.push(`${jmeno}: hlásí scope_applied, ale owner_company z p_params nečte`);
  }
  return out;
}

describe("osa „podle firmy“: kdo ji čte, ohlásí ji", () => {
  const soubory = Object.fromEntries(
    fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf-8")]),
  );

  it("měřidlo má co měřit: osu čte aspoň devět RPC", () => {
    const ctenaru = Object.entries(soubory).filter(
      ([f, s]) => f !== "scope_applied.sql" && CTE.test(s.replace(/--[^\n]*/g, "")),
    ).length;
    expect(ctenaru).toBeGreaterThanOrEqual(9);
  });

  it("každá RPC, která osu čte, ji ohlásí — a žádná ji nehlásí naprázdno", () => {
    expect(nalezy(soubory)).toEqual([]);
  });

  it("kontrolní vzorek: RPC, která filtruje a mlčí, bránou neprojde", () => {
    const mlci = {
      "x.sql": "select 1 where r.fields->'owner_company'->>'value' = p_params->>'owner_company'",
    };
    expect(nalezy(mlci)).toEqual(["x.sql: čte owner_company z p_params, ale neohlásí scope_applied"]);
    const zminka = { "y.sql": "-- p_params->>'owner_company' jen v komentáři\nselect 1" };
    expect(nalezy(zminka), "komentář není čtení").toEqual([]);
    const naprazdno = { "z.sql": "select public.scope_applied(p_params, 'owner_company')" };
    expect(nalezy(naprazdno)).toEqual(["z.sql: hlásí scope_applied, ale owner_company z p_params nečte"]);
  });
});
