/**
 * Zdravotní data: člen čte svá, konzultant jen se souhlasem, nikdo jiný nic.
 *
 * ⛔ NAMĚŘENO 2026-10-04: is_consultant_for_user neměla grant pro authenticated
 * a volá ji devět RLS politik na zdravotních tabulkách. PostgreSQL vyhodnocuje
 * VŠECHNY použitelné politiky, takže čtení health_check_ins padalo na
 * „permission denied for function" — člen nečetl ani svoje.
 *
 * ROZHODNUTÍ 2026-10-05 (majitel): souhlas se kontroluje PŘÍMO VE FUNKCI.
 * Vazba „konzultant" platí jen pro přihlášený EXISTUJÍCÍ účet (gateway razí roli
 * `authenticated` i návštěvníkovi bez účtu), schváleného konzultanta studie, kde
 * je člen aktivně zapsaný, a s platným souhlasem člena tomuto konzultantovi.
 *
 * Každé „nevidí" má vedle sebe kontrolní vzorek „vidí", jinak by test prošel
 * i nad prázdnou databází.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ALICE = randomUUID(); // členka, dala souhlas konzultantovi KAREL
const BOB = randomUUID(); // člen téže studie, souhlas nedal
const KAREL = randomUUID(); // schválený konzultant studie, má souhlas Alice
const KLARA = randomUUID(); // schválená konzultantka téže studie, souhlas nemá
const HOST = randomUUID(); // token s rolí authenticated, ale bez účtu
const STUDIE = randomUUID();
const PARTNER_KAREL = randomUUID();
const PARTNER_KLARA = randomUUID();

/** Čí check-iny z fixtury identita v health_check_ins vidí (seřazeně), nebo chyba DB. */
const vidi = (kdo: string): string => {
  const sql = `SELECT coalesce(string_agg(DISTINCT user_id::text, ',' ORDER BY user_id::text), '')
                 FROM public.health_check_ins WHERE user_id IN ('${ALICE}', '${BOB}')`;
  const chyba = zkus(prihlaseny(kdo), sql);
  return chyba === "PROSLO" ? jako(prihlaseny(kdo), sql) : `CHYBA: ${chyba.match(/ERROR:\s+([^\n]+)/)?.[1] ?? chyba}`;
};
const jeKonzultant = (kdo: string, pro: string) =>
  jako(prihlaseny(kdo), `SELECT public.is_consultant_for_user('${pro}')::text`);

describe.skipIf(!isPgReachable())("is_consultant_for_user: souhlas uvnitř, existující přihlášený účet", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ALICE}', 'konz-alice-${RUN}@test.local'), ('${BOB}', 'konz-bob-${RUN}@test.local'),
               ('${KAREL}', 'konz-karel-${RUN}@test.local'), ('${KLARA}', 'konz-klara-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES
               ('${ALICE}', 'member'), ('${BOB}', 'member'), ('${KAREL}', 'member'), ('${KLARA}', 'member')
             ON CONFLICT DO NOTHING`);
    fixtura(`INSERT INTO public.studies (id, code, name, study_type)
             VALUES ('${STUDIE}', 'konz-${RUN}', 'Studie ${RUN}', 'observational')`);
    fixtura(`INSERT INTO public.partner_profiles (id, user_id, display_name, city) VALUES
               ('${PARTNER_KAREL}', '${KAREL}', 'Karel ${RUN}', 'Brno'),
               ('${PARTNER_KLARA}', '${KLARA}', 'Klára ${RUN}', 'Brno')`);
    fixtura(`INSERT INTO public.study_consultants (study_id, partner_id, status) VALUES
               ('${STUDIE}', '${PARTNER_KAREL}', 'approved'), ('${STUDIE}', '${PARTNER_KLARA}', 'approved')`);
    fixtura(`INSERT INTO public.study_registrations (study_id, user_id, status) VALUES
               ('${STUDIE}', '${ALICE}', 'active'), ('${STUDIE}', '${BOB}', 'active')`);
    fixtura(`INSERT INTO public.data_sharing_consents (user_id, partner_id) VALUES ('${ALICE}', '${PARTNER_KAREL}')`);
    // Check-in zapisuje sám člen — tak, jak to dělá appka.
    jako(prihlaseny(ALICE), `INSERT INTO public.health_check_ins (user_id, pain_level) VALUES ('${ALICE}', 6)`);
    jako(prihlaseny(BOB), `INSERT INTO public.health_check_ins (user_id, pain_level) VALUES ('${BOB}', 2)`);
  });

  it("⛔ člen čte svá zdravotní data jako přihlášený — a jen svá", () => {
    expect(vidi(ALICE), "Alice nečte svá data (nebo čte i Bobova)").toBe(ALICE);
    expect(vidi(BOB), "Bob nečte svá data (nebo čte i Alicina)").toBe(BOB);
  });

  it("⛔ konzultant vidí jen toho, kdo mu dal souhlas", () => {
    expect(vidi(KAREL), "Karel nevidí Alici (má souhlas), nebo vidí Boba (nemá)").toBe(ALICE);
    expect(vidi(KLARA), "Klára bez souhlasu vidí cizí data").toBe("");
  });

  it("⛔ token bez existujícího účtu nevidí nic, i když nese roli authenticated", () => {
    expect(vidi(HOST)).toBe("");
    expect(jeKonzultant(HOST, ALICE)).toBe("false");
  });

  it("funkce sama: pravda jen pro konzultanta se souhlasem; nic neprozradí ostatním", () => {
    expect(jeKonzultant(KAREL, ALICE), "kontrolní vzorek: Karel se souhlasem").toBe("true");
    expect(jeKonzultant(KAREL, BOB), "Bob souhlas nedal").toBe("false");
    expect(jeKonzultant(KLARA, ALICE), "zápis ve studii bez souhlasu nestačí").toBe("false");
    expect(jeKonzultant(ALICE, BOB), "člen není konzultant jiného člena").toBe("false");
    expect(zkus(ANON, `SELECT public.is_consultant_for_user('${ALICE}')`))
      .toMatch(/permission denied for function is_consultant_for_user/);
  });

  it("⛔ odvolaný souhlas vezme konzultantovi přístup", () => {
    fixtura(`UPDATE public.data_sharing_consents SET revoked_at = now()
              WHERE user_id = '${ALICE}' AND partner_id = '${PARTNER_KAREL}'`);
    expect(vidi(KAREL)).toBe("");
    expect(jeKonzultant(KAREL, ALICE)).toBe("false");
    expect(vidi(ALICE), "odvolání nesmí vzít přístup členovi k jeho vlastním datům").toBe(ALICE);
  });
});
