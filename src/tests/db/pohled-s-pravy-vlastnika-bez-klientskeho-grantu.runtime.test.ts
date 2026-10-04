/**
 * Pohled s právy vlastníka nesmí mít přímý grant klientské roli.
 *
 * Pohled bez `security_invoker` se čte (a u auto-updatable pohledu i zapisuje)
 * právy VLASTNÍKA — tedy mimo RLS podkladových tabulek. Přímý grant pro
 * `anon`/`authenticated` z něj proto dělá zadní vrátka kolem všech policies
 * i kolem stráží DEFINER funkcí, které ho mají číst za klienta.
 *
 * ⛔ NAMĚŘENO 2026-10-04 na čisté DB (baseline + heals): 21 takových pohledů
 * bylo čitelných klientskou rolí, 9 z nich i bez přihlášení. Měří se katalog
 * živé databáze, ne SoT soubory — granty přicházejí i z heals a z ALTER
 * DEFAULT PRIVILEGES, které statická brána nevidí.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

/**
 * VĚDOMĚ VEŘEJNÉ PROJEKCE — čtení klientem je jejich účel. Každá položka má
 * důvod; nová položka je rozhodnutí, ne řádek navíc.
 */
const VEREJNE_PRO_CTENI: Record<string, string> = {
  public_service_health: "stavová stránka služeb; jen SELECT (heals 2026-08-06 odebral DML)",
  partner_profiles_public: "veřejný adresář partnerů, filtr is_visible = true",
};

/** Pohledy a mat. pohledy v public bez security_invoker, s právy rolí. */
function pohledySPravyVlastnika(): Array<{ jmeno: string; prava: string }> {
  const radky = fixtura(`
    SELECT c.relname || '|' || concat_ws(',',
             CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'anon:SELECT' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'authenticated:SELECT' END,
             CASE WHEN has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') THEN 'anon:DML' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') THEN 'authenticated:DML' END)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                      WHERE option_name = 'security_invoker'), 'false') <> 'true'
     ORDER BY c.relname`);
  return radky
    .split("\n")
    .filter(Boolean)
    .map((r) => {
      const [jmeno, prava = ""] = r.split("|");
      return { jmeno, prava };
    });
}

describe.skipIf(!isPgReachable())("pohled s právy vlastníka: bez přímého grantu klientům", () => {
  it("⛔ audience_admin_*_v klient přímo nečte (jen přes DEFINER blokové funkce)", () => {
    const audience = pohledySPravyVlastnika().filter((p) => /^audience_admin_[a-z0-9_]+_v$/.test(p.jmeno));
    expect(audience.length, "žádný audience_admin_*_v pohled — měřidlo měří nad ničím").toBeGreaterThan(10);

    const sKlientskymPravem = audience.filter((p) => p.prava !== "").map((p) => `${p.jmeno} (${p.prava})`);
    expect(sKlientskymPravem, "pohled s právy vlastníka má přímý grant klientské roli").toEqual([]);
  });

  it("⛔ žádný pohled s právy vlastníka nečte klient — kromě vědomě veřejných projekcí", () => {
    const vsechny = pohledySPravyVlastnika();
    expect(vsechny.length, "katalog bez pohledů — měřidlo měří nad ničím").toBeGreaterThan(20);

    const citelne = vsechny
      .filter((p) => /:SELECT/.test(p.prava) && !(p.jmeno in VEREJNE_PRO_CTENI))
      .map((p) => `${p.jmeno} (${p.prava})`);
    expect(citelne, "pohled s právy vlastníka (mimo RLS podkladu) čte klientská role").toEqual([]);

    const zmizele = Object.keys(VEREJNE_PRO_CTENI).filter((j) => !vsechny.some((p) => p.jmeno === j));
    expect(zmizele, "výjimka pro pohled, který už neexistuje nebo dostal security_invoker — smaž ji").toEqual([]);
  });

  it("⛔ žádný pohled s právy vlastníka nemá pro klienta zápis — bez výjimky", () => {
    const zapisovatelne = pohledySPravyVlastnika()
      .filter((p) => /:DML/.test(p.prava))
      .map((p) => `${p.jmeno} (${p.prava})`);
    expect(zapisovatelne, "DML skrz auto-updatable pohled s právy vlastníka obchází RLS podkladu").toEqual([]);
  });

  it("⛔ přihlášený NEpřepíše cizí partnerský profil skrz veřejný adresář", () => {
    const partner = randomUUID();
    const utocnik = randomUUID();
    const run = partner.slice(0, 8);
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${partner}', 'adresar-partner-${run}@test.local'), ('${utocnik}', 'adresar-utocnik-${run}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.partner_profiles (user_id, display_name, city, website, is_visible)
             VALUES ('${partner}', 'Partner ${run}', 'Brno', 'https://partner.example', true)`);

    expect(jako(ANON, `SELECT count(*) FROM public.partner_profiles_public WHERE user_id = '${partner}'`),
      "veřejný adresář partnera nevidí — sonda je slepá").toBe("1");
    expect(zkus(prihlaseny(utocnik),
      `UPDATE public.partner_profiles_public SET website = 'https://phish.example' WHERE user_id = '${partner}'`))
      .toMatch(/permission denied for view partner_profiles_public/);
    expect(zkus(prihlaseny(utocnik), `DELETE FROM public.partner_profiles_public WHERE user_id = '${partner}'`))
      .toMatch(/permission denied for view partner_profiles_public/);
    expect(fixtura(`SELECT website FROM public.partner_profiles WHERE user_id = '${partner}'`)).toBe("https://partner.example");
  });

  it("anon nečte kohortní souhrny studií ani úpravy dávkování; admin je dostane přes DEFINER RPC", () => {
    for (const pohled of ["study_cohort_statistics", "study_cohort_trends", "distribution_adjustments_overview"]) {
      expect(zkus(ANON, `SELECT count(*) FROM public.${pohled}`)).toMatch(/permission denied for view/);
    }
    const admin = randomUUID();
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES ('${admin}', 'pohledy-admin-${admin.slice(0, 8)}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES ('${admin}', 'admin') ON CONFLICT DO NOTHING`);
    // Kontrolní vzorek: čtecí cesta se strážemi (DEFINER) dál funguje — revoke
    // nezavřel data adminovi, jen zadní vrátka.
    expect(() => jako(prihlaseny(admin), "SELECT count(*) FROM public.get_study_cohort_statistics_secure()")).not.toThrow();
    expect(() => jako(prihlaseny(admin), "SELECT public.get_ai_agent_metrics(24)")).not.toThrow();
  });
});
