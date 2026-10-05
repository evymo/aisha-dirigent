/**
 * Check-in bez přihlášeného uživatele (služba, import) nespadne na streak triggeru.
 *
 * ⛔ NAMĚŘENO 2026-10-04 při testu v_health_* souhrnů: INSERT do health_check_ins
 * pod službou skončil „ERROR: Unauthorized" z trigger_update_streak_on_health_checkin
 * (stráž `auth.uid() IS NULL → RAISE`). Trigger funkci přímo zavolat nejde, takže
 * stráž nikoho neodmítala — jen shazovala každý zápis mimo uživatelskou relaci
 * i s check-inem samotným.
 *
 * Druhá polovina: update_user_streak (DEFINER, p_user_id od volajícího) smí volat
 * jen trigger, ne přihlášený — jinak by si kdokoli posouval streak komukoli.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { SLUZBA, fixtura, jako, prihlaseny } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const IMPORT = randomUUID();
const CLEN = randomUUID();

const streak = (uid: string) =>
  fixtura(`SELECT coalesce(current_streak::text, 'zadny') FROM public.token_allocations WHERE user_id = '${uid}'`);

describe.skipIf(!isPgReachable())("streak trigger health_check_ins", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${IMPORT}', 'streak-import-${RUN}@test.local'),
               ('${CLEN}',   'streak-clen-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES ('${IMPORT}', 'member'), ('${CLEN}', 'member')
             ON CONFLICT DO NOTHING`);
  });

  // Úklid: celá sada sdílí jednu DB a schema-validation-v2 hlídá, že projektové
  // tabulky (PROJEKTOVE_TABULKY) zůstanou po seedu PRÁZDNÉ.
  afterAll(() => {
    fixtura(`DELETE FROM public.health_check_ins WHERE user_id IN ('${IMPORT}', '${CLEN}')`);
  });

  it("⛔ služba vloží check-in za uživatele a streak se započítá", () => {
    jako(SLUZBA, `INSERT INTO public.health_check_ins (user_id, pain_level, data_source) VALUES ('${IMPORT}', 4, 'import')`);
    expect(fixtura(`SELECT count(*) FROM public.health_check_ins WHERE user_id = '${IMPORT}'`)).toBe("1");
    expect(streak(IMPORT)).toBe("1");
  });

  it("uživatel vloží vlastní check-in dál (kontrolní vzorek)", () => {
    jako(prihlaseny(CLEN), `INSERT INTO public.health_check_ins (user_id, pain_level) VALUES ('${CLEN}', 2)`);
    expect(streak(CLEN)).toBe("1");
  });

  it("update_user_streak ani trigger funkci přihlášený přímo nespustí", () => {
    const pravo = (fn: string) => fixtura(`SELECT has_function_privilege('authenticated', '${fn}', 'execute')::text`);
    expect(pravo("public.update_user_streak(uuid)")).toBe("false");
    expect(pravo("public.trigger_update_streak_on_health_checkin()")).toBe("false");
  });
});
