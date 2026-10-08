/**
 * Měřák definer funkcí — vidí stínitelný odkaz, volání bez schématu a nebezpečnou
 * dočasnou tabulku tam, kde jsou, a nevidí je tam, kde nejsou.
 *
 * Spouští se přes: npx vitest run --config vitest.scripts.config.mjs scripts/lib/definer-search-path.test.mjs
 */
import { describe, expect, it } from "vitest";
import { cestaHledani, docasneNebezpecne, odkazyBezSchematu, rozborDefineru } from "./definer-search-path.mjs";

const SLOVNIK = {
  relace: new Set(["profiles", "user_roles", "audit_journal"]),
  typy: new Set(["app_role"]),
  funkce: new Set(["is_admin_or_staff", "current_tier"]),
};
const fn = (hlavicka, telo) => `CREATE OR REPLACE FUNCTION public.f() RETURNS void\nLANGUAGE plpgsql\n${hlavicka}\nAS $$\n${telo}\n$$;`;
const rozbor = (hlavicka, telo) => rozborDefineru(fn(hlavicka, telo), SLOVNIK);

describe("stínění dočasným objektem", () => {
  it("bez pg_temp v cestě je nekvalifikovaná relace stínitelná", () => {
    const r = rozbor("SECURITY DEFINER\nSET search_path TO 'public'", "BEGIN PERFORM 1 FROM profiles; END");
    expect(r.stinitelna).toBe(true);
    expect(r.relace).toEqual(["profiles"]);
  });

  it("pg_temp POSLEDNÍ cestu zavírá; pg_temp jinde ne", () => {
    const telo = "BEGIN PERFORM 1 FROM profiles; END";
    expect(rozbor("SECURITY DEFINER\nSET search_path TO 'pg_catalog', 'public', 'pg_temp'", telo).stinitelna).toBe(false);
    expect(rozbor("SECURITY DEFINER\nSET search_path TO 'pg_temp', 'public'", telo).stinitelna).toBe(true);
    expect(rozbor("SECURITY DEFINER", telo).stinitelna).toBe(true);
  });

  it("kvalifikovaná relace stínitelná není", () => {
    const r = rozbor("SECURITY DEFINER\nSET search_path TO 'public'", "BEGIN PERFORM 1 FROM public.profiles p JOIN public.user_roles r ON true; END");
    expect(r.stinitelna).toBe(false);
  });

  it("zápisové příkazy, typy a katalog se počítají", () => {
    const o = odkazyBezSchematu(
      "DECLARE v profiles%ROWTYPE; x user_roles.role%TYPE; BEGIN INSERT INTO audit_journal VALUES (1); UPDATE profiles SET a = 1; " +
        "PERFORM 'admin'::app_role; PERFORM 1 FROM pg_class; TRUNCATE TABLE user_roles; END",
      SLOVNIK,
    );
    expect(o.relace).toEqual(["audit_journal", "profiles", "user_roles"]);
    expect(o.typy).toEqual(["::app_role", "profiles%rowtype", "user_roles.role%type"]);
    expect(o.katalog).toEqual(["pg_class"]);
  });

  it("FROM, které není klauzule dotazu, relaci nevyrobí", () => {
    const o = odkazyBezSchematu(
      "BEGIN PERFORM extract(epoch FROM profiles_ts), trim(both ' ' FROM v); IF a IS DISTINCT FROM profiles THEN NULL; END IF; " +
        "INSERT INTO public.audit_journal VALUES (1) ON CONFLICT DO UPDATE SET a = 1; PERFORM 1 FROM public.profiles FOR UPDATE; END",
      SLOVNIK,
    );
    expect(o.relace).toEqual([]);
  });

  it("CTE, komentář ani řetězec nejsou odkaz na relaci", () => {
    const o = odkazyBezSchematu(
      "BEGIN\n-- FROM profiles\nWITH profiles AS (SELECT 1) SELECT * FROM profiles;\nEXECUTE 'SELECT 1 FROM user_roles';\nEND",
      SLOVNIK,
    );
    expect(o.relace).toEqual([]);
    expect(o.dynamicke).toBe(true);
  });
});

describe("volání funkce instance bez schématu", () => {
  it("bez schématu se počítá i s pg_temp v cestě — pro funkce se pg_temp nehledá", () => {
    const r = rozbor("SECURITY DEFINER\nSET search_path TO 'pg_catalog', 'public', 'pg_temp'", "BEGIN IF NOT is_admin_or_staff() THEN RAISE EXCEPTION 'x'; END IF; END");
    expect(r.volaBezSchematu).toBe(true);
    expect(r.funkce).toEqual(["is_admin_or_staff"]);
    expect(r.stinitelna).toBe(false);
  });

  it("se schématem, vestavěná funkce ani sloupec téhož jména se nepočítají", () => {
    const r = rozbor("SECURITY DEFINER\nSET search_path TO 'public'", "BEGIN PERFORM public.is_admin_or_staff(), coalesce(a, b), t.current_tier FROM public.profiles t; END");
    expect(r.volaBezSchematu).toBe(false);
  });
});

describe("dočasná tabulka v definer funkci", () => {
  it("IF NOT EXISTS převezme tabulku volajícího", () => {
    expect(docasneNebezpecne("BEGIN CREATE TEMPORARY TABLE IF NOT EXISTS _x (a int) ON COMMIT DROP; TRUNCATE _x; END")).toEqual(["_x"]);
  });
  it("bez DROP … pg_temp nebo s holým odkazem tvar nedrží", () => {
    expect(docasneNebezpecne("BEGIN CREATE TEMP TABLE _x (a int); INSERT INTO pg_temp._x VALUES (1); END")).toEqual(["_x"]);
    expect(docasneNebezpecne("BEGIN DROP TABLE IF EXISTS pg_temp._x; CREATE TEMP TABLE _x (a int); PERFORM 1 FROM _x; END")).toEqual(["_x"]);
  });
  it("bezpečný tvar projde; jméno s podřetězcem se neplete", () => {
    expect(
      docasneNebezpecne("BEGIN DROP TABLE IF EXISTS pg_temp._x; CREATE TEMPORARY TABLE _x (a int) ON COMMIT DROP; INSERT INTO pg_temp._x VALUES (1); PERFORM 1 FROM pg_temp._x JOIN public.tab_x t ON true; END"),
    ).toEqual([]);
  });
});

describe("co není definer nebo nejde rozebrat", () => {
  it("funkce bez SECURITY DEFINER se neměří; zmínka v komentáři ji definerem nedělá", () => {
    expect(rozbor("-- ZÁMĚRNĚ BEZ SECURITY DEFINER", "BEGIN PERFORM 1 FROM profiles; END")).toBeNull();
  });
  it("definer bez dolarového těla je NEROZEBRÁNO, ne čisto", () => {
    expect(rozborDefineru("CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER RETURN 1;", SLOVNIK)).toEqual({ nerozebrano: true });
  });
  it("cesta se čte z hlavičky i s rovnítkem a bez uvozovek", () => {
    expect(cestaHledani("SET search_path = pg_catalog, public, pg_temp")).toEqual(["pg_catalog", "public", "pg_temp"]);
    expect(cestaHledani("SET search_path TO 'public'")).toEqual(["public"]);
    expect(cestaHledani("STABLE")).toBeNull();
  });
});
