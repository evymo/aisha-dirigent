/**
 * Brána: profil vzniká S JMÉNEM A E-MAILEM, a existující prázdné se dorovnají.
 *
 * ⛔ NAMĚŘENO V PROD 2026-09-06: `handle_new_user()` zakládal profil jen
 * s identifikátory (`id`, `user_id`) — e-mail ani jméno z účtu se do něj nikdy
 * nedostaly. 7 účtů ze 7 mělo obojí prázdné. Registr publika i popisek dvojčete
 * z nich čtou (`twin_backfill_accounts_admin` staví label jako
 * COALESCE(display_name, email)), takže CELÁ plocha byla bezejmenná: sedm řádků,
 * u kterých nešlo poznat, kdo to je. Jedna příčina, tři příznaky.
 *
 * CO SE MĚŘÍ:
 *   1. nový účet → profil hned nese e-mail i jméno (jméno tolerantně z metadat:
 *      `display_name`, `name`, `full_name`, `preferred_username`);
 *   2. účet BEZ jména → profil má e-mail a jméno NULL, aby pohled degradoval na
 *      e-mail místo prázdna;
 *   3. dorovnání existujícího prázdného profilu doplní obojí a NEPŘEPÍŠE ruční
 *      úpravu (pravda o člověku není seed).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const PLNY = "c9000000-1111-4000-8000-0000000000d1";
const BEZ_JMENA = "c9000000-2222-4000-8000-0000000000d2";
const PRAZDNY = "c9000000-3333-4000-8000-0000000000d3";
const RUCNI = "c9000000-4444-4000-8000-0000000000d4";

/** Dorovnání ze heals — držené v testu ve stejném tvaru, aby se měřilo pravidlo, ne kopie. */
const DOROVNANI = `
UPDATE public.profiles p
   SET email = nullif(btrim(coalesce(u.email, '')), '')
  FROM aisha_auth.users u
 WHERE u.id = p.user_id
   AND nullif(btrim(coalesce(p.email, '')), '') IS NULL
   AND nullif(btrim(coalesce(u.email, '')), '') IS NOT NULL;
UPDATE public.profiles p
   SET display_name = nullif(btrim(coalesce(u.raw_user_meta_data->>'display_name',
         u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'preferred_username', '')), '')
  FROM aisha_auth.users u
 WHERE u.id = p.user_id
   AND nullif(btrim(coalesce(p.display_name, '')), '') IS NULL
   AND nullif(btrim(coalesce(u.raw_user_meta_data->>'display_name',
         u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'preferred_username', '')), '') IS NOT NULL;`;

describe("profil nese jméno a e-mail", () => {
  beforeAll(() => reportTestCapabilities("profil nese jméno"));

  it.skipIf(!dbAvailable)("nový účet dá profil s e-mailem i jménem; bez jména degraduje na e-mail", () => {
    const out = psqlMultiline(`
BEGIN;
INSERT INTO aisha_auth.users (id, email, raw_user_meta_data) VALUES
  ('${PLNY}', 'pj-plny@test.local', '{"name":"Zkušební Jméno"}'::jsonb),
  ('${BEZ_JMENA}', 'pj-bez@test.local', '{}'::jsonb);
SELECT 'plny=' || coalesce(email,'(NULL)') || '/' || coalesce(display_name,'(NULL)') AS out
  FROM public.profiles WHERE user_id = '${PLNY}';
SELECT 'bez_jmena=' || coalesce(email,'(NULL)') || '/' || coalesce(display_name,'(NULL)') AS out
  FROM public.profiles WHERE user_id = '${BEZ_JMENA}';
ROLLBACK;
`);
    expect(out, "jméno se bere i z klíče `name`, ne jen `display_name`").toContain("plny=pj-plny@test.local/Zkušební Jméno");
    expect(out, "bez jména musí zbýt e-mail, aby pohled nedegradoval na prázdno").toContain("bez_jmena=pj-bez@test.local/(NULL)");
  });

  it.skipIf(!dbAvailable)("dorovnání doplní prázdný profil a nepřepíše ruční úpravu", () => {
    const out = psqlMultiline(`
BEGIN;
INSERT INTO aisha_auth.users (id, email, raw_user_meta_data) VALUES
  ('${PRAZDNY}', 'pj-prazdny@test.local', '{"name":"Z Metadat"}'::jsonb),
  ('${RUCNI}', 'pj-rucni@test.local', '{"name":"Z Metadat"}'::jsonb);
-- simuluj STAV PŘED opravou: profil bez jména a e-mailu
UPDATE public.profiles SET email = NULL, display_name = NULL WHERE user_id = '${PRAZDNY}';
-- a profil, který někdo pojmenoval ručně
UPDATE public.profiles SET email = NULL, display_name = 'Ručně Pojmenovaný' WHERE user_id = '${RUCNI}';
${DOROVNANI}
SELECT 'dorovnany=' || coalesce(email,'(NULL)') || '/' || coalesce(display_name,'(NULL)') AS out
  FROM public.profiles WHERE user_id = '${PRAZDNY}';
SELECT 'rucni=' || coalesce(email,'(NULL)') || '/' || coalesce(display_name,'(NULL)') AS out
  FROM public.profiles WHERE user_id = '${RUCNI}';
ROLLBACK;
`);
    expect(out).toContain("dorovnany=pj-prazdny@test.local/Z Metadat");
    expect(out, "ruční jméno je pravda o člověku — seed ji nepřepisuje").toContain("rucni=pj-rucni@test.local/Ručně Pojmenovaný");
  });
});
