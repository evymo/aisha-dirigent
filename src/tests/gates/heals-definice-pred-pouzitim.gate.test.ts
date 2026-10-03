/**
 * Brána: heals.sql zakládá dřív, než používá — v obou směrech.
 *
 * ⛔ NAMĚŘENO 2026-09-28: heals zakládal `twin_relations` (ř. 9049) AŽ ZA
 * funkcemi, které ji čtou (`get_twin_detail` ř. 8207, `get_scope_options`
 * ř. 8710, obě LANGUAGE sql → Postgres je validuje při CREATE). Na živé DB
 * z baseline 29. 7. (tabulka přibyla 2. 8.) proto migrate spadl a core
 * instance zůstalo dole. Čerstvá ani průběžně migrovaná DB to neukáže: tam
 * objekt dodá baseline dřív, než heals začne. Proto se to měří staticky,
 * proti DNU — nejstarší živé DB.
 *
 * Pravidlo: co heals VALIDOVANĚ použije (tabulka / funkce / pohled / typ …),
 * musí heals založit DŘÍV, nebo to musí mít dno
 * (`heals-definice-pred-pouzitim.dno.json`, měří `scripts/db/heals-dno.mjs`).
 * Jedno pravidlo kryje oba směry: spotřebitele před tabulkou i blok, který by
 * stál před vlastní závislostí — a navíc objekt, který heals nezakládá vůbec.
 * Co je „validovaně", viz scripts/lib/heals-definice-pred-pouzitim.mjs.
 *
 * Starší než dno se vědomě nepodporuje: pod dnem 17. 7. měřidlo najde další
 * zlomy (surface_audience_allows, document_visible_to, tabulky tc_*) — žádná
 * živá DB tak stará není. Kdo by takovou obnovoval ze zálohy, posune dno a
 * brána mu ukáže přesně, co je v heals potřeba zapojit.
 *
 * Dynamický důkaz (skutečný Postgres, DB z dna → migrate větve) je UPGRADE
 * ověření v popisu PR; tahle brána drží, aby se třída nevrátila.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { poruseni } from "../../../scripts/lib/heals-definice-pred-pouzitim.mjs";

const DB = join(process.cwd(), "aisha/db");
const HEALS = readFileSync(join(DB, "heals.sql"), "utf8");
const DNO_JSON = JSON.parse(readFileSync(join(__dirname, "heals-definice-pred-pouzitim.dno.json"), "utf8")) as {
  commit: string;
  datum: string;
  dukaz: string;
  objekty: string[];
};
const DNO = new Set(DNO_JSON.objekty);
const ctiRepo = (rel: string) => {
  const p = join(DB, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};
const popis = (v: ReturnType<typeof poruseni>) =>
  v
    .map(
      (p) =>
        `${p.jmeno} (${p.druh}) založen ${p.definovano.soubor}:${p.definovano.radek}, ` +
        `ale použit dřív: ${p.pouzito.map((u) => `ř. ${u.radek} ${u.soubor}`).join(", ")}`,
    )
    .join("\n");

/** Přesune řádek `\ir <rel>` na konec heals — vrácené pořadí, jaké bylo před opravou. */
function presunNaKonec(heals: string, rel: string): string {
  const radek = `\\ir ${rel}`;
  const radky = heals.split("\n");
  const i = radky.findIndex((l) => l.trim() === radek);
  expect(i, `mutace potřebuje řádek ${radek}`).toBeGreaterThanOrEqual(0);
  radky.splice(i, 1);
  return [...radky, radek].join("\n");
}

describe("heals.sql: definice před použitím", () => {
  it("nic se nepoužije dřív, než to heals založí nebo než to má dno", () => {
    const v = poruseni(HEALS, ctiRepo, DNO);
    expect(v, `Na DB z dna (${DNO_JSON.datum}) by migrate spadl:\n${popis(v)}`).toEqual([]);
  });

  it("mutace: tabulka twin_relations zpět ZA spotřebitele → červená", () => {
    const v = poruseni(presunNaKonec(HEALS, "sql/tables/twin_relations.sql"), ctiRepo, DNO);
    const t = v.find((p) => p.jmeno === "twin_relations");
    expect(t, popis(v)).toBeDefined();
    expect(t!.pouzito.map((u) => u.soubor)).toContain("sql/functions/get_twin_detail.sql");
  });

  it("dno je měřené a sedí se svým důkazem", () => {
    expect(DNO_JSON.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(DNO_JSON.dukaz.length).toBeGreaterThan(40);
    expect(DNO_JSON.objekty.length).toBeGreaterThan(1000);
    // Důkaz říká: živá DB měla twin_entities a neměla twin_relations.
    expect(DNO.has("twin_entities")).toBe(true);
    expect(DNO.has("twin_relations")).toBe(false);
  });
});

describe("měřidlo: co je validované použití a co ne (kontrolní vzorky)", () => {
  const soubory: Record<string, string> = {};
  const cti = (rel: string) => soubory[rel] ?? null;
  const tabulka = "CREATE TABLE IF NOT EXISTS public.nova (id int);";
  const mer = (pred: string, dno: string[] = []) => poruseni(`${pred}\n${tabulka}\n`, cti, new Set(dno)).map((p) => p.jmeno);

  it("SQL funkce čte tabulku před jejím založením → porušení", () => {
    expect(mer("CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ select count(*)::int from public.nova $$;")).toEqual(["nova"]);
  });
  it("plpgsql tělo se při CREATE nevaliduje → bez porušení", () => {
    expect(mer("CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE plpgsql AS $$ begin return (select count(*) from public.nova); end $$;")).toEqual([]);
  });
  it("DO blok se vykoná hned → porušení", () => {
    expect(mer("DO $$ begin perform 1 from public.nova; end $$;")).toEqual(["nova"]);
  });
  it("DO blok, který existenci sám ověřuje (to_regclass), → bez porušení", () => {
    expect(mer("DO $$ begin if to_regclass('public.nova') is null then return; end if; perform 1 from public.nova; end $$;")).toEqual([]);
  });
  it("policy nad tabulkou před jejím založením → porušení", () => {
    expect(mer("CREATE POLICY p ON public.nova FOR SELECT USING (true);")).toEqual(["nova"]);
  });
  it("použití objektu, který heals NEZAKLÁDÁ a dno nemá → porušení", () => {
    const v = poruseni("CREATE POLICY p ON public.nikde FOR SELECT USING (true);\n", cti, new Set());
    expect(v.map((p) => p.jmeno)).toEqual(["nikde"]);
  });
  it("komentář, literál a DROP … IF EXISTS nejsou použití", () => {
    expect(mer("-- public.nova\nSELECT to_regclass('public.nova');\nDROP POLICY IF EXISTS p ON public.nova;")).toEqual([]);
  });
  it("objekt, který má dno, smí heals použít dřív → bez porušení", () => {
    expect(mer("CREATE POLICY p ON public.nova FOR SELECT USING (true);", ["nova"])).toEqual([]);
  });
  it("DO blok přes více řádků heals se čte vcelku (definice za ním nezmizí)", () => {
    const v = poruseni(
      "DO $$\nbegin\n  perform 1;\nend $$;\nCREATE FUNCTION public.g() RETURNS int LANGUAGE sql AS $$ select 1 $$;\n" +
        "CREATE POLICY p ON public.nova FOR SELECT USING (public.g() = 1);\n" + tabulka,
      cti,
      new Set(["nova"]),
    );
    expect(v).toEqual([]);
  });
  it("použití uvnitř \\ir se připíše řádku \\ir a souboru, ne komentáři nad ním", () => {
    soubory["sql/functions/g.sql"] = "-- hlavička\nCREATE FUNCTION public.g() RETURNS int LANGUAGE sql AS $$ select 1 from public.nova $$;";
    const v = poruseni(`-- komentář nad\n\\ir sql/functions/g.sql\n${tabulka}\n`, cti, new Set());
    expect(v[0].pouzito[0]).toEqual({ radek: 2, soubor: "sql/functions/g.sql" });
  });
});
