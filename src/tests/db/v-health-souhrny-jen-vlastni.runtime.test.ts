/**
 * v_health_weekly/monthly_summary: každý vidí jen souhrny, na které má nárok.
 *
 * ⛔ NÁLEZ 2026-10-04 (revize SQL): oba pohledy byly bez security_invoker, tedy
 * čtené právy VLASTNÍKA mimo RLS tabulky health_check_ins, a měly GRANT SELECT
 * pro anon a plné DML pro authenticated. Tep, bolest, nálada a spánek všech
 * uživatelů tak šly přečíst přes /rest/v1/v_health_* i bez účtu.
 *
 * INVARIANT: pohled nesmí dát VÍC, než dá pod touž identitou podkladová
 * tabulka. Porovnává se odpověď pohledu s odpovědí health_check_ins (včetně
 * případné chyby). Bez security_invoker pohled vracel všechny.
 *
 * Kontrolní vzorek: služba vidí OBA uživatele — prázdno u člena by jinak mohlo
 * znamenat jen to, že fixtura do pohledu vůbec nedoteče.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, SLUZBA, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const ALICE = randomUUID();
const BOB = randomUUID();
const POHLEDY = ["v_health_weekly_summary", "v_health_monthly_summary"] as const;

type Kdo = Parameters<typeof jako>[0];
/** Uživatelé z fixtury, které identita v relaci vidí (seřazení, čárkou), nebo chyba DB. */
const viditelni = (kdo: Kdo, relace: string): string => {
  const sql = `SELECT coalesce(string_agg(DISTINCT user_id::text, ',' ORDER BY user_id::text), '')
                 FROM public.${relace} WHERE user_id IN ('${ALICE}', '${BOB}')`;
  try {
    return jako(kdo, sql);
  } catch {
    return `CHYBA: ${zkus(kdo, sql).match(/ERROR:\s+([^\n]+)/)?.[1] ?? "?"}`;
  }
};
const oba = [ALICE, BOB].sort().join(",");

describe.skipIf(!isPgReachable())("v_health_* souhrny: RLS podkladu platí i skrz pohled", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}', 'zdravi-admin-${RUN}@test.local'),
               ('${ALICE}', 'zdravi-alice-${RUN}@test.local'),
               ('${BOB}',   'zdravi-bob-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES
               ('${ADMIN}', 'admin'), ('${ALICE}', 'member'), ('${BOB}', 'member')
             ON CONFLICT DO NOTHING`);
    // Check-in zapisuje sám uživatel — tak, jak to dělá appka (RLS „Users can
    // insert their own check-ins").
    jako(prihlaseny(ALICE), `INSERT INTO public.health_check_ins (user_id, pain_level, mood_level, heart_rate_avg)
                             VALUES ('${ALICE}', 7, 2, 88)`);
    jako(prihlaseny(BOB), `INSERT INTO public.health_check_ins (user_id, pain_level, mood_level, heart_rate_avg)
                           VALUES ('${BOB}', 3, 8, 64)`);
  });

  for (const pohled of POHLEDY) {
    it(`${pohled}: služba vidí oba (kontrolní vzorek)`, () => {
      expect(viditelni(SLUZBA, pohled), "služba nevidí fixturu — sonda je slepá").toBe(oba);
    });

    it(`⛔ ${pohled}: člen vidí svůj souhrn, cizí ne`, () => {
      // Od 2026-10-05 (grant is_consultant_for_user) čte člen přesně sebe — dřív
      // padalo čtení podkladu i pohledu na „permission denied for function".
      expect(viditelni(prihlaseny(ALICE), pohled), "Alice nevidí svůj souhrn, nebo vidí Bobův").toBe(ALICE);
      expect(viditelni(prihlaseny(BOB), pohled), "Bob nevidí svůj souhrn, nebo vidí Alicin").toBe(BOB);
    });

    it(`⛔ ${pohled}: nikdo nedostane víc než z health_check_ins`, () => {
      for (const kdo of [ALICE, BOB, ADMIN]) {
        expect(viditelni(prihlaseny(kdo), pohled), `pohled dal ${kdo} jinou odpověď než podkladová tabulka`)
          .toBe(viditelni(prihlaseny(kdo), "health_check_ins"));
      }
    });

    it(`⛔ ${pohled}: anon nečte nic`, () => {
      expect(zkus(ANON, `SELECT count(*) FROM public.${pohled}`)).toMatch(/permission denied for view/);
    });

    it(`${pohled}: granty jen SELECT, a jen přihlášeným a službě`, () => {
      const prava = fixtura(`SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type)
                               FROM information_schema.role_table_grants
                              WHERE table_schema = 'public' AND table_name = '${pohled}'
                                AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')`);
      expect(prava).toBe("authenticated:SELECT,service_role:SELECT");
    });
  }
});
