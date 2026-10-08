/**
 * Pohled s právy vlastníka nesmí mít přímý grant klientské roli — měřeno KATALOGEM.
 *
 * Pohled bez `security_invoker` se čte (a u auto-updatable pohledu i zapisuje)
 * právy VLASTNÍKA — tedy mimo RLS podkladových tabulek. Přímý grant pro
 * `anon`/`authenticated` z něj proto dělá zadní vrátka kolem všech policies
 * i kolem stráží SECURITY DEFINER funkcí, které ho mají číst za klienta.
 *
 * ⛔ NAMĚŘENO 2026-10-06 na čisté DB main 0f992f647 (baseline + heals + seed):
 * 25 takových pohledů čitelných klientskou rolí, 11 z nich i bez přihlášení
 * (v_health_* = souhrny stavu ze snímačů KAŽDÉHO vlastníka, kohorty, zásilky…),
 * 12 s DML pro authenticated. Ve GitHub stagingu opraveno 10-04, upstream ne.
 * Měří se katalog živé databáze, ne SoT soubory — granty přicházejí i z heals
 * a z ALTER DEFAULT PRIVILEGES, které statická brána (anon-grants-select-only)
 * nevidí. Výčet vědomě veřejných projekcí je JEDEN pro obě:
 * src/tests/gates/pohledy-verejne-pro-cteni.json.
 *
 * ⛔ KONTROLNÍ VZORKY jsou povinné: revoke nesmí zavřít data tomu, kdo je čte
 * legitimně (DEFINER funkce se strážemi), a prázdno nesmí znamenat slepou sondu.
 *
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:pohledy-edge
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, SLUZBA, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const VEREJNE = (
  JSON.parse(readFileSync(join(__dirname, "../gates/pohledy-verejne-pro-cteni.json"), "utf8")) as {
    verejne: Record<string, { role: string[] }>;
  }
).verejne;

interface Pohled {
  jmeno: string;
  invoker: boolean;
  prava: string[];
}

/** Všechny pohledy a mat. pohledy v public s tím, co na ně smí anon/authenticated. */
function pohledy(): Pohled[] {
  const radky = fixtura(`
    SELECT c.relname || '|' ||
           coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                      WHERE option_name = 'security_invoker'), 'false') || '|' ||
           concat_ws(',',
             CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'anon:SELECT' END,
             CASE WHEN has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') THEN 'anon:DML' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'authenticated:SELECT' END,
             CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') THEN 'authenticated:DML' END)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       -- zz_* jsou dočasné kopie jiných testů ve sdílené DB (pohled-jde-nahradit), ne schéma
       AND c.relname NOT LIKE 'zz\\_%'
     ORDER BY c.relname`);
  return radky
    .split("\n")
    .filter(Boolean)
    .map((r) => {
      const [jmeno, invoker, prava = ""] = r.split("|");
      return { jmeno, invoker: invoker === "true", prava: prava ? prava.split(",") : [] };
    });
}

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const ALICE = randomUUID();
const BOB = randomUUID();
const PARTNER = randomUUID();

describe.skipIf(!isPgReachable())("pohled s právy vlastníka: bez přímého grantu klientům (katalog)", () => {
  it("měřidlo měří nad skutečným katalogem", () => {
    expect(pohledy().length, "katalog bez pohledů — měřidlo měří nad ničím").toBeGreaterThan(40);
  });

  it("⛔ žádný pohled s právy vlastníka nečte klient — kromě vědomě veřejných projekcí", () => {
    const citelne = pohledy()
      .filter((p) => !p.invoker)
      .flatMap((p) =>
        p.prava
          .filter((x) => x.endsWith(":SELECT"))
          .filter((x) => !(VEREJNE[p.jmeno]?.role ?? []).includes(x.split(":")[0]))
          .map((x) => `${p.jmeno} (${x})`),
      );
    expect(citelne, "pohled s právy vlastníka (mimo RLS podkladu) čte klientská role").toEqual([]);
  });

  it("⛔ anon nečte ŽÁDNÝ pohled, který není vyjmenovaný jako veřejný (ani security_invoker)", () => {
    const anon = pohledy()
      .filter((p) => p.prava.includes("anon:SELECT") && !(VEREJNE[p.jmeno]?.role ?? []).includes("anon"))
      .map((p) => p.jmeno);
    expect(anon).toEqual([]);
  });

  it("⛔ žádný pohled s právy vlastníka nemá pro klienta zápis — bez výjimky", () => {
    const zapis = pohledy()
      .filter((p) => !p.invoker && p.prava.some((x) => x.endsWith(":DML")))
      .map((p) => `${p.jmeno} (${p.prava.join(",")})`);
    expect(zapis, "DML skrz auto-updatable pohled s právy vlastníka obchází RLS podkladu").toEqual([]);
  });

  it("výčet veřejných projekcí je živý (existují, běží s právy vlastníka, role sedí)", () => {
    const vsechny = new Map(pohledy().map((p) => [p.jmeno, p]));
    const vady: string[] = [];
    for (const [jmeno, { role }] of Object.entries(VEREJNE)) {
      const p = vsechny.get(jmeno);
      if (!p) vady.push(`${jmeno}: v katalogu není — smaž výjimku`);
      else if (p.invoker) vady.push(`${jmeno}: má security_invoker — výjimku nepotřebuje`);
      else for (const r of role) if (!p.prava.includes(`${r}:SELECT`)) vady.push(`${jmeno}: ${r} ho nečte — výjimka je navíc`);
    }
    expect(vady).toEqual([]);
  });
});

describe.skipIf(!isPgReachable())("pohledy s právy vlastníka: chování identit + kontrolní vzorky", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}', 'pohledy-admin-${RUN}@test.local'), ('${ALICE}', 'pohledy-alice-${RUN}@test.local'),
               ('${BOB}', 'pohledy-bob-${RUN}@test.local'), ('${PARTNER}', 'pohledy-partner-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES
               ('${ADMIN}', 'admin'), ('${ALICE}', 'member'), ('${BOB}', 'member')
             ON CONFLICT DO NOTHING`);
    // Check-in vzniká s přihlášeným vlastníkem (trigger streaku chce auth.uid()).
    fixtura(`INSERT INTO public.health_check_ins (user_id, pain_level, mood_level, heart_rate_avg) VALUES ('${ALICE}', 7, 2, 88)`, ALICE);
    fixtura(`INSERT INTO public.health_check_ins (user_id, pain_level, mood_level, heart_rate_avg) VALUES ('${BOB}', 3, 8, 64)`, BOB);
    fixtura(`INSERT INTO public.partner_profiles (user_id, display_name, city, website, is_visible)
             VALUES ('${PARTNER}', 'Partner ${RUN}', 'Brno', 'https://partner.example', true)`);
  });

  // Celá sada sdílí jednu DB a schema-validation-v2 hlídá prázdné projektové tabulky po seedu.
  afterAll(() => {
    fixtura(`DELETE FROM public.health_check_ins WHERE user_id IN ('${ALICE}', '${BOB}')`);
    fixtura(`DELETE FROM public.partner_profiles WHERE user_id = '${PARTNER}'`);
  });

  const viditelni = (kdo: Parameters<typeof jako>[0], relace: string, pred?: string): string => {
    const sql = `SELECT coalesce(string_agg(DISTINCT user_id::text, ',' ORDER BY user_id::text), '')
                   FROM public.${relace} WHERE user_id IN ('${ALICE}', '${BOB}')`;
    try {
      return jako(kdo, sql, { pred, rollback: true });
    } catch (err) {
      const e = err as { stderr?: string };
      return `CHYBA: ${String(e.stderr ?? err).match(/ERROR:\s+([^\n]+)/)?.[1] ?? "?"}`;
    }
  };
  const oba = [ALICE, BOB].sort().join(",");
  // Predikáty RLS health_check_ins volají is_consultant_for_user, která do rozhodnutí
  // o kontrole souhlasu (GitHub PR #2, 2026-10-05) nemá grant pro authenticated →
  // čtení podkladu i pohledu člen dostane jako „permission denied" (fail-closed).
  // Pozitivní cestu (vlastník vidí sebe) proto sonda měří s grantem jen v transakci.
  const sGrantemPredikatu = "GRANT EXECUTE ON FUNCTION public.is_consultant_for_user(uuid) TO authenticated";

  for (const pohled of ["v_health_weekly_summary", "v_health_monthly_summary"]) {
    it(`${pohled}: služba vidí oba vlastníky (kontrolní vzorek — fixtura doteče do pohledu)`, () => {
      expect(viditelni(SLUZBA, pohled), "služba nevidí fixturu — sonda je slepá").toBe(oba);
    });

    it(`⛔ ${pohled}: anon nečte nic (dřív souhrny všech vlastníků bez přihlášení)`, () => {
      expect(zkus(ANON, `SELECT count(*) FROM public.${pohled}`)).toMatch(/permission denied for view/);
    });

    it(`⛔ ${pohled}: pohled nedá nikomu víc než podkladová tabulka pod touž identitou`, () => {
      for (const kdo of [ALICE, BOB, ADMIN]) {
        expect(viditelni(prihlaseny(kdo), pohled), `pohled dal ${kdo} jinou odpověď než health_check_ins`).toBe(
          viditelni(prihlaseny(kdo), "health_check_ins"),
        );
        expect(viditelni(prihlaseny(kdo), pohled, sGrantemPredikatu)).toBe(
          viditelni(prihlaseny(kdo), "health_check_ins", sGrantemPredikatu),
        );
      }
    });

    it(`⛔ ${pohled}: vlastník vidí svůj souhrn a cizí ne (RLS podkladu skrz pohled)`, () => {
      expect(viditelni(prihlaseny(ALICE), pohled, sGrantemPredikatu), "Alice nevidí sebe, nebo vidí Boba").toBe(ALICE);
      expect(viditelni(prihlaseny(BOB), pohled, sGrantemPredikatu), "Bob nevidí sebe, nebo vidí Alici").toBe(BOB);
      // Bez grantu predikátu: chyba, NIKDY cizí řádky.
      expect(viditelni(prihlaseny(ALICE), pohled)).not.toContain(BOB);
    });

    it(`${pohled}: jen SELECT, jen přihlášeným a službě`, () => {
      const prava = fixtura(`SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type)
                               FROM information_schema.role_table_grants
                              WHERE table_schema = 'public' AND table_name = '${pohled}'
                                AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')`);
      expect(prava).toBe("authenticated:SELECT,service_role:SELECT");
    });
  }

  it("⛔ přihlášený NEpřepíše ani nesmaže cizí partnerský profil skrz veřejný adresář", () => {
    expect(jako(ANON, `SELECT count(*) FROM public.partner_profiles_public WHERE user_id = '${PARTNER}'`),
      "veřejný adresář partnera nevidí ani anon — sonda je slepá").toBe("1");
    expect(zkus(prihlaseny(ALICE),
      `UPDATE public.partner_profiles_public SET website = 'https://phish.example' WHERE user_id = '${PARTNER}'`))
      .toMatch(/permission denied for view partner_profiles_public/);
    expect(zkus(prihlaseny(ALICE), `DELETE FROM public.partner_profiles_public WHERE user_id = '${PARTNER}'`))
      .toMatch(/permission denied for view partner_profiles_public/);
    expect(fixtura(`SELECT website FROM public.partner_profiles WHERE user_id = '${PARTNER}'`)).toBe("https://partner.example");
  });

  it("⛔ anon ani člen nečtou souhrny kohort, dávkování, zásilky; člen ani audience_admin_*_v", () => {
    for (const p of ["study_cohort_statistics", "study_cohort_trends", "study_cohort_lab_trends",
      "distribution_adjustments_overview", "distribution_overview", "batch_inventory_overview",
      "expedition_overview", "shipment_statistics"]) {
      expect(zkus(ANON, `SELECT count(*) FROM public.${p}`), `${p}: anon`).toMatch(/permission denied for view/);
      expect(zkus(prihlaseny(ALICE), `SELECT count(*) FROM public.${p}`), `${p}: člen`).toMatch(/permission denied for view/);
    }
    for (const p of ["audience_admin_twin_timeline_v", "audience_admin_twin_directory_v", "audience_admin_followup_queue_v"]) {
      expect(zkus(prihlaseny(ALICE), `SELECT count(*) FROM public.${p}`), `${p}: člen`).toMatch(/permission denied for view/);
    }
    expect(zkus(prihlaseny(ALICE), "SELECT count(*) FROM public.ai_agent_metrics_hourly"))
      .toMatch(/permission denied for materialized view/);
  });

  it("kontrolní vzorek: čtecí cesty se strážemi (DEFINER) dál vydávají data správě", () => {
    // Revoke zavřel zadní vrátka, ne data — DEFINER funkce čte právy vlastníka.
    expect(() => jako(prihlaseny(ADMIN), "SELECT count(*) FROM public.get_study_cohort_statistics_secure()")).not.toThrow();
    expect(() => jako(prihlaseny(ADMIN), "SELECT public.get_ai_agent_metrics(24)")).not.toThrow();
    // …a člen bez role tytéž funkce nedostane jako zadní vrátka zpět.
    expect(zkus(prihlaseny(ALICE), "SELECT public.get_ai_agent_metrics(24)")).not.toBe("PROSLO");
  });
});
