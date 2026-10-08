/**
 * Klientská role nemá na žádné relaci právo, které RLS nehlídá.
 *
 * SELECT/INSERT/UPDATE/DELETE pro `anon`/`authenticated` jdou přes RLS politiky.
 * TRUNCATE, REFERENCES a TRIGGER ne: TRUNCATE vyprázdní celou tabulku bez ohledu
 * na politiky, TRIGGER/REFERENCES dovolí věšet na cizí tabulku triggery a cizí
 * klíče.
 *
 * ⛔ NAMĚŘENO 2026-10-08: granty z pg_dump éry dávaly `authenticated` všech sedm
 * práv na 254 tabulkách, storage.buckets/objects měly GRANT ALL z infra init.
 * Měří se katalog živé DB (baseline + heals), ne SoT soubory — práva přicházejí
 * i z heals, infra init a ALTER DEFAULT PRIVILEGES, které statická brána
 * (authenticated-grants-bez-ddl) nevidí.
 */
import { describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { fixtura, prihlaseny, zkus } from "./sonda-identity";

const MIMO_RLS = ["TRUNCATE", "REFERENCES", "TRIGGER"] as const;

/** Relace v public/storage, na které má role aspoň jedno právo mimo RLS. */
function relaceSPravemMimoRls(role: "anon" | "authenticated"): string[] {
  const sloupce = MIMO_RLS.map(
    (p) => `CASE WHEN has_table_privilege('${role}', c.oid, '${p}') THEN '${p}' END`,
  ).join(", ");
  return fixtura(`
    SELECT n.nspname || '.' || c.relname || ' (' || concat_ws(',', ${sloupce}) || ')'
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'storage')
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       -- zz_* jsou dočasné kopie jiných testů ve sdílené DB, ne schéma.
       AND c.relname NOT LIKE 'zz\\_%'
       AND (${MIMO_RLS.map((p) => `has_table_privilege('${role}', c.oid, '${p}')`).join(" OR ")})
     ORDER BY 1`)
    .split("\n")
    .filter(Boolean);
}

describe.skipIf(!isPgReachable())("klientská role: žádné právo mimo RLS", () => {
  it("měřidlo měří nad skutečným katalogem", () => {
    const pocet = Number(
      fixtura(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`),
    );
    expect(pocet, "public bez tabulek — měřidlo by tvrdilo prázdno").toBeGreaterThan(200);
  });

  it("⛔ authenticated nemá TRUNCATE/REFERENCES/TRIGGER na žádné relaci", () => {
    expect(relaceSPravemMimoRls("authenticated")).toEqual([]);
  });

  it("⛔ anon nemá TRUNCATE/REFERENCES/TRIGGER na žádné relaci", () => {
    expect(relaceSPravemMimoRls("anon")).toEqual([]);
  });

  it("⛔ přihlášený TRUNCATE skutečně neprovede", () => {
    // Kdyby TRUNCATE prošel, výjimka v témže bloku ho vrátí — test nikdy nemaže data.
    const chyba = zkus(
      prihlaseny("00000000-0000-4000-8000-00000000c0de"),
      `DO $$ BEGIN TRUNCATE public.profiles; RAISE EXCEPTION 'TRUNCATE_PROSEL'; END $$`,
    );
    expect(chyba).toMatch(/permission denied/);
    expect(chyba).not.toMatch(/TRUNCATE_PROSEL/);
  });
});
