/**
 * Měřák grantů na schéma — vidí grant práva VYTVÁŘET tam, kde opravdu je,
 * a nevidí ho tam, kde není.
 *
 * Každý případ je vzorek tvaru, který ve stromu existuje nebo by mohl vzniknout.
 * Spouští se přes: npx vitest run scripts/lib/grant-na-schema.test.mjs
 */
import { describe, expect, it } from "vitest";
import { bezKomentaru, kdoSmiVytvaret, prikazyNaSchema } from "./grant-na-schema.mjs";

const tvurci = (text, pripona = ".sql") =>
  kdoSmiVytvaret(bezKomentaru(text, pripona)).tvurci.map((t) => t.role);

describe("grant práva vytvářet ve schématu public", () => {
  it("vidí CREATE pro PUBLIC, ať je zapsané jakkoli", () => {
    expect(tvurci("GRANT USAGE, CREATE ON SCHEMA public TO public;")).toEqual(["PUBLIC"]);
    expect(tvurci("grant create on schema public to PUBLIC;")).toEqual(["PUBLIC"]);
    expect(tvurci('GRANT CREATE ON SCHEMA "public" TO PUBLIC;')).toEqual(["PUBLIC"]);
    expect(tvurci("GRANT CREATE\n  ON SCHEMA public\n  TO public;")).toEqual(["PUBLIC"]);
  });

  it("ALL i ALL PRIVILEGES obsahují CREATE", () => {
    expect(tvurci("GRANT ALL ON SCHEMA public TO postgres;")).toEqual(["postgres"]);
    expect(tvurci("GRANT ALL PRIVILEGES ON SCHEMA public TO public;")).toEqual(["PUBLIC"]);
  });

  it("samotné USAGE právo vytvářet není", () => {
    expect(tvurci("GRANT USAGE ON SCHEMA public TO public;")).toEqual([]);
    expect(tvurci("GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;")).toEqual([]);
  });

  it("jiné schéma se nepočítá, seznam schémat ano", () => {
    expect(tvurci("GRANT USAGE, CREATE ON SCHEMA n8n TO n8n_app;")).toEqual([]);
    expect(tvurci("GRANT CREATE ON SCHEMA extensions, public TO sluzba;")).toEqual(["sluzba"]);
  });

  it("role v uvozovkách i příkaz bez středníku v řetězci skriptu", () => {
    expect(tvurci('GRANT CREATE ON SCHEMA public TO "nocodb_app";')).toEqual(["nocodb_app"]);
    expect(tvurci('run("GRANT CREATE ON SCHEMA public TO sluzba", x);', ".mjs")).toEqual(["sluzba"]);
  });

  it("vrátí každého příjemce zvlášť, bez dovětků příkazu", () => {
    expect(tvurci("GRANT CREATE ON SCHEMA public TO a_app, GROUP b_app WITH GRANT OPTION;")).toEqual(["a_app", "b_app"]);
  });

  it("grant na tabulky ve schématu ani výchozí práva nejsou grant na schéma", () => {
    expect(tvurci("GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO nocodb_app;")).toEqual([]);
    expect(tvurci("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;")).toEqual([]);
  });

  it("REVOKE není grant — a měřák ho vrací jako REVOKE", () => {
    expect(tvurci("REVOKE CREATE ON SCHEMA public FROM PUBLIC;")).toEqual([]);
    const [p] = prikazyNaSchema("REVOKE CREATE ON SCHEMA public FROM PUBLIC;");
    expect(p).toMatchObject({ akce: "REVOKE", prava: ["CREATE"] });
    expect(p.role.map((r) => r.jmeno)).toEqual(["PUBLIC"]);
  });

  it("tělo DO bloku je kód a měří se", () => {
    const sql = `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nocodb_app') THEN
        GRANT USAGE, CREATE ON SCHEMA public TO nocodb_app;
      END IF;
    END $$;`;
    expect(tvurci(sql)).toEqual(["nocodb_app"]);
  });
});

describe("komentář není kód", () => {
  it("SQL komentář s příkazem se nepočítá", () => {
    expect(tvurci("-- dřív: GRANT CREATE ON SCHEMA public TO public;\nSELECT 1;")).toEqual([]);
    expect(tvurci("/* GRANT CREATE ON SCHEMA public TO public; */ SELECT 1;")).toEqual([]);
  });

  it("komentář skriptu se nepočítá, řetězec pod ním ano", () => {
    const js = [
      "/** dřív: GRANT CREATE ON SCHEMA public TO public; */",
      "// dřív: GRANT CREATE ON SCHEMA public TO public;",
      "const sql = `GRANT CREATE ON SCHEMA public TO sluzba;`; // GRANT ALL ON SCHEMA public TO public;",
    ].join("\n");
    expect(tvurci(js, ".mjs")).toEqual(["sluzba"]);
    const sh = "# GRANT CREATE ON SCHEMA public TO public;\nprintf 'GRANT CREATE ON SCHEMA public TO sluzba;\\n'";
    expect(tvurci(sh, ".sh")).toEqual(["sluzba"]);
  });

  it("adresa ani glob v řetězci skriptu komentář nezačnou", () => {
    const js = 'const u = "https://example.test"; const g = "src/*"; const s = "GRANT ALL ON SCHEMA public TO sluzba;";';
    expect(tvurci(js, ".mjs")).toEqual(["sluzba"]);
  });
});

describe("odstraňuje se jen to, co komentářem prokazatelně je", () => {
  it("v shellu je -- přepínač, ne komentář: příkaz za ním se měří", () => {
    const sh = 'psql --quiet -v ON_ERROR_STOP=1 -c "GRANT CREATE ON SCHEMA public TO public;"';
    expect(tvurci(sh, ".sh")).toEqual(["PUBLIC"]);
    expect(tvurci('spust -- psql -c "GRANT CREATE ON SCHEMA public TO public;"', ".sh")).toEqual(["PUBLIC"]);
  });

  it("v shellu je /* glob, ne komentář: zbytek souboru se měří", () => {
    const sh = 'for f in "$DIR"/*.sql; do psql -f "$f"; done\npsql -c "GRANT CREATE ON SCHEMA public TO public;"';
    expect(tvurci(sh, ".sh")).toEqual(["PUBLIC"]);
  });

  it("v YAMLu padá jen celý řádek s #, ne zbytek řádku za hodnotou", () => {
    const yml = '      # GRANT CREATE ON SCHEMA public TO public;\n      - "GRANT USAGE, CREATE ON SCHEMA public TO sluzba;"  # pozn.';
    expect(tvurci(yml, ".yml")).toEqual(["sluzba"]);
  });

  it("SQL komentář uvnitř řetězce skriptu zůstává — příkaz za ním se měří", () => {
    const js = "const sql = `\n  -- vrátit práva\n  GRANT CREATE ON SCHEMA public TO sluzba;`;";
    expect(tvurci(js, ".mjs")).toEqual(["sluzba"]);
  });
});

describe("co nejde změřit, není čisto", () => {
  it("role nebo schéma skládané za běhu jdou do nezměřených", () => {
    const a = kdoSmiVytvaret("EXECUTE format('GRANT CREATE ON SCHEMA public TO %I', r);");
    expect(a.tvurci).toEqual([]);
    expect(a.nezmereno).toHaveLength(1);
    const b = kdoSmiVytvaret("GRANT USAGE, CREATE ON SCHEMA ${schema} TO sluzba;");
    expect(b.tvurci).toEqual([]);
    expect(b.nezmereno).toHaveLength(1);
  });

  it("dynamický grant BEZ práva vytvářet se neeviduje", () => {
    expect(kdoSmiVytvaret("GRANT USAGE ON SCHEMA ${schema} TO sluzba;").nezmereno).toEqual([]);
  });
});
