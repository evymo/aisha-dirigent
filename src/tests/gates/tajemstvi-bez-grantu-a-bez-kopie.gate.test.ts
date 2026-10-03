/**
 * Brána: tabulka s tajemstvími NEMÁ grant pro anon/authenticated a žádná SQL
 * funkce do `app_secrets` NEZAPISUJE (nešifrovaná kopie).
 *
 * ⛔ NAMĚŘENO 2026-09-28 (riq produkce, jen čtení): `app_secrets` měla SELECT pro
 * `anon` a ALL pro `authenticated`; chránila ji jen RLS politika „admin" (force
 * off). `set_api_key_admin` psal vedle trezoru i NEŠIFROVANOU kopii „pro zpětnou
 * kompatibilitu" a get_app_secret/_batch četly právě ji — admin (i útok přes jeho
 * relaci) četl klíče přímo `GET /rest/v1/app_secrets`.
 *
 * Univerzum se ODVOZUJE (tabulky `*secret*` v SoT), ne vyjmenovává — nová tabulka
 * s tajemstvími spadne pod bránu sama. Grant se hledá tam, kde ho databáze
 * dostane: soubory grants/ i heals.sql (běžící DB baseline znovu nepřehrává).
 *
 * Kontrolní vzorek: vzorky nad dnešními soubory musí NAJÍT aspoň jednu tabulku
 * a aspoň jednu funkci, která se na app_secrets odkazuje (čtenáře) — jinak by
 * brána prošla i nad prázdným univerzem.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SQL = resolve(__dirname, "../../../aisha/db/sql");
const HEALS = resolve(__dirname, "../../../aisha/db/heals.sql");

const tabulkyTajemstvi = readdirSync(join(SQL, "tables"))
  .filter((f) => /secret/i.test(f) && f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""));

/** Obsah, ze kterého DB granty skutečně dostane (bez komentářů). */
const bezKomentaru = (s: string) => s.replace(/--.*$/gm, "");
const zdrojeGrantu = [
  ...readdirSync(join(SQL, "grants")).map((f) => ({ jmeno: `grants/${f}`, text: bezKomentaru(readFileSync(join(SQL, "grants", f), "utf-8")) })),
  { jmeno: "heals.sql", text: bezKomentaru(readFileSync(HEALS, "utf-8")) },
];

const funkce = readdirSync(join(SQL, "functions"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ jmeno: f, text: bezKomentaru(readFileSync(join(SQL, "functions", f), "utf-8")) }));

describe("brána: tajemství bez grantu pro klienty a bez nešifrované kopie", () => {
  it("kontrolní vzorek: univerzum tabulek s tajemstvími není prázdné a obsahuje app_secrets", () => {
    expect(tabulkyTajemstvi.length).toBeGreaterThan(0);
    expect(tabulkyTajemstvi).toContain("app_secrets");
  });

  it("žádný GRANT na tabulku s tajemstvími pro anon / authenticated / PUBLIC", () => {
    const vady: string[] = [];
    for (const t of tabulkyTajemstvi) {
      const re = new RegExp(
        String.raw`GRANT\s+[^;]*\bON\s+(TABLE\s+)?(public\.)?${t}\b[^;]*\bTO\s+[^;]*\b(anon|authenticated|PUBLIC)\b`,
        "i",
      );
      for (const z of zdrojeGrantu) if (re.test(z.text)) vady.push(`${z.jmeno}: ${t}`);
    }
    expect(vady, "tabulka s tajemstvími čitelná přes REST — granty patří jen vlastníkovi (DEFINER)").toEqual([]);
  });

  it("app_secrets má výslovný REVOKE pro anon i authenticated (běžící DB baseline nepřehrává)", () => {
    const g = zdrojeGrantu.find((z) => z.jmeno === "grants/app_secrets.sql")!.text;
    expect(g).toMatch(/REVOKE\s+ALL\s+ON\s+(TABLE\s+)?public\.app_secrets\s+FROM\s+[^;]*\banon\b[^;]*\bauthenticated\b/i);
    expect(zdrojeGrantu.find((z) => z.jmeno === "heals.sql")!.text).toMatch(/\\ir sql\/grants\/app_secrets\.sql/);
  });

  it("plošný grant při cold startu (fix_missing_table_grants) tabulky s tajemstvími vynechá", () => {
    const g = zdrojeGrantu.find((z) => z.jmeno === "grants/fix_missing_table_grants.sql")!.text;
    // smyčka přes pg_tables, která grantuje authenticated, musí `secret` vynechat
    expect(g).toMatch(/FROM\s+pg_tables[\s\S]*?tablename\s+NOT\s+I?LIKE\s+'%secret%'[\s\S]*?LOOP/i);
  });

  it("kontrolní vzorek: funkce, které app_secrets znají, se najdou (převod do trezoru)", () => {
    expect(funkce.filter((f) => /\bapp_secrets\b/i.test(f.text)).length).toBeGreaterThan(0);
  });

  it("žádná funkce do app_secrets nezapisuje (INSERT/UPDATE) — domov hodnot je trezor", () => {
    const vady = funkce
      .filter((f) => /\b(INSERT\s+INTO|UPDATE)\s+(public\.)?app_secrets\b/i.test(f.text))
      .map((f) => f.jmeno);
    expect(vady, "nešifrovaná kopie tajemství v app_secrets").toEqual([]);
  });

  it("čtenáři (get_app_secret, get_app_secrets_batch, GitHub) berou trezor, ne app_secrets", () => {
    for (const jmeno of ["get_app_secret.sql", "get_app_secrets_batch.sql", "get_github_app_secrets_from_vault.sql"]) {
      const f = funkce.find((x) => x.jmeno === jmeno)!;
      expect(f.text, `${jmeno}: čte nešifrovanou app_secrets`).not.toMatch(/\bFROM\s+(public\.)?app_secrets\b/i);
      expect(f.text, `${jmeno}: nečte trezor`).toMatch(/vault\.decrypted_secrets/);
    }
  });
});

/**
 * Zpevnění (b) 2026-09-29 — žádné obecné šifrovací/dešifrovací orákulum a tabulka
 * domova pověření bez grantu pro role. Změřeno: jediný volající orákula je DEFINER
 * get_plugin_runtime_config (a set_data_source_secrets pro šifrování); runtime chování
 * měří povereni-zpevneni.runtime.test.ts, tady se hlídá, aby se GRANT do SoT nevrátil.
 */
describe("brána: orákulum a tabulka domova pověření (zpevnění b)", () => {
  const ORAKULA = ["aisha_decrypt_column_audited", "aisha_encrypt_column_audited"];
  const vsechnyZdroje = [...zdrojeGrantu, ...funkce.map((f) => ({ jmeno: `functions/${f.jmeno}`, text: f.text }))];
  const grantNaFunkci = (text: string, fn: string) =>
    new RegExp(String.raw`GRANT\s+(EXECUTE|ALL)[^;]*\bON\s+FUNCTION\s+(public\.)?${fn}\b[^;]*\bTO\b`, "i").test(text);

  it("KONTROLNÍ VZOREK (mutace): detektor přidaný GRANT chytí, REVOKE ne", () => {
    expect(grantNaFunkci("GRANT EXECUTE ON FUNCTION public.aisha_decrypt_column_audited(bytea, jsonb) TO service_role;", ORAKULA[0])).toBe(true);
    expect(grantNaFunkci("grant all on function aisha_encrypt_column_audited(text, jsonb) to authenticated;", ORAKULA[1])).toBe(true);
    expect(grantNaFunkci("REVOKE ALL ON FUNCTION public.aisha_decrypt_column_audited(bytea, jsonb) FROM service_role;", ORAKULA[0])).toBe(false);
  });

  it("orákula nemají GRANT pro žádnou roli (soubory funkcí, granty, heals)", () => {
    const vady = ORAKULA.flatMap((fn) => vsechnyZdroje.filter((z) => grantNaFunkci(z.text, fn)).map((z) => `${z.jmeno}: ${fn}`));
    expect(vady, "obecné orákulum — volat ho smí jen DEFINER funkce domova").toEqual([]);
  });

  it("orákula mají výslovný REVOKE i pro service_role (běžící DB má staré granty)", () => {
    for (const fn of ORAKULA) {
      const f = funkce.find((x) => x.jmeno === `${fn}.sql`)!;
      expect(f.text, fn).toMatch(new RegExp(String.raw`REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.${fn}\([^)]*\)\s+FROM\s+[^;]*\bservice_role\b`, "i"));
    }
  });

  it("tabulka domova: výslovný REVOKE pro anon, authenticated i service_role a \\ir v heals", () => {
    const g = zdrojeGrantu.find((z) => z.jmeno === "grants/agent_knowledge_source_secrets.sql");
    expect(g, "chybí grants/agent_knowledge_source_secrets.sql").toBeDefined();
    expect(g!.text).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.agent_knowledge_source_secrets\s+FROM\s+[^;]*\banon\b[^;]*\bauthenticated\b[^;]*\bservice_role\b/i);
    expect(zdrojeGrantu.find((z) => z.jmeno === "heals.sql")!.text).toMatch(/\\ir sql\/grants\/agent_knowledge_source_secrets\.sql/);
  });

  it("stav klíčů ve správě nedešifruje a je v heals", () => {
    const f = funkce.find((x) => x.jmeno === "get_api_keys_status_admin.sql")!;
    expect(f.text, "stav klíčů dešifruje (vault.decrypted_secrets)").not.toMatch(/decrypted_secrets/);
    expect(zdrojeGrantu.find((z) => z.jmeno === "heals.sql")!.text).toMatch(/\\ir sql\/functions\/get_api_keys_status_admin\.sql/);
  });
});
