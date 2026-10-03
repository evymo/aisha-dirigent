import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Kampaně: publikum podle SEKCE + zavřená stráž — RUNTIME proti skutečné DB.
 *
 * Proč runtime a ne grep: obě vlastnosti, které se tu drží, jsou o CHOVÁNÍ
 * databáze pod konkrétní identitou. Zdrojový kód o nich neřekne nic:
 *
 *  1. `edge_notification_campaigns` byla SECURITY DEFINER s `GRANT … TO
 *     authenticated` a BEZ autorizace — každý přihlášený si mohl vytáhnout
 *     seznam všech uživatelů instance. Zavřely se OBOJE dveře: grant pro
 *     `authenticated` je zrušený (vnější) a funkce má stráž (vnitřní).
 *     Test to zkouší JAKO přihlášený uživatel a drží tu VLASTNOST, na které
 *     záleží — „běžný účet seznam uživatelů nedostane" — bez ohledu na to,
 *     které z těch dvou dveří zrovna zaberou. Mutace stráže (2026-09-21,
 *     ještě před zrušením grantu) test shodila, takže měří, co tvrdí.
 *
 *  2. Publikum `surface_section` musí vydat PRÁVĚ ty uživatele, kterým sekci
 *     povolí `surface_audience_allows` — tedy týž predikát, podle kterého se
 *     sekce zobrazuje. Test staví dvě identity (admin × běžný účet) a ověřuje
 *     OBĚ strany: kdo tam být má i kdo tam být nesmí. Jednostranné tvrzení
 *     („admin tam je") by prošlo i funkci, která vrací všechny.
 *
 *  3. Neznámá sekce musí VYHODIT, ne vrátit prázdno. Překlep v `section` by
 *     jinak vypadal jako „kampaň proběhla, jen nikoho nezastihla".
 *
 * RAISE uvnitř DO bloku → nenulový exit psql → psqlMultiline vyhodí → pád testu.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

beforeAll(async () => {
  await reportTestCapabilities("Kampaně: publikum podle sekce");
});

describe("kampaně — publikum podle sekce (živá DB)", () => {
  it.skipIf(!dbAvailable)(
    "stráž odmítne přihlášeného bez správcovských práv",
    () => {
      const vystup = psqlMultiline(
        HEADER +
          `
begin;
  -- Běžný účet bez rolí: přesně ten, komu dřív funkce vydala seznam všech uživatelů.
  select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  do $$
  declare
    v_chyba text;
  begin
    begin
      perform public.edge_notification_campaigns('get_all_profile_user_ids', '{}'::jsonb);
      raise exception 'STRÁŽ NEDRŽÍ: přihlášený bez práv dostal seznam uživatelů';
    exception
      when insufficient_privilege then
        null;  -- očekávané: 42501 Unauthorized
      when others then
        get stacked diagnostics v_chyba = message_text;
        if v_chyba like '%STRÁŽ NEDRŽÍ%' then raise; end if;
        raise exception 'jiná chyba než Unauthorized: %', v_chyba;
    end;
  end $$;
rollback;
select 'STRAZ_OK' as vysledek;
`,
      );
      expect(vystup).toContain("STRAZ_OK");
    },
    120_000,
  );

  it.skipIf(!dbAvailable)(
    "publikum sekce vydá právě ty, komu ji predikát povolí",
    () => {
      const vystup = psqlMultiline(
        HEADER +
          `
begin;
  set local role service_role;

  do $$
  declare
    v_spravce uuid := gen_random_uuid();
    v_bezny   uuid := gen_random_uuid();
    v_sekce   text := 'test_sekce_kampane';
    v_ids     uuid[];
  begin
    -- Dvě identity: jedna se správcovskou rolí, druhá bez ní.
    insert into aisha_auth.users (id, email) values
      (v_spravce, 'spravce-' || v_spravce || '@test.invalid'),
      (v_bezny,   'bezny-'   || v_bezny   || '@test.invalid');
    -- Profil zakládá spouštěč nad aisha_auth.users sám; tohle je jen pojistka
    -- pro případ, že by v téhle instalaci spouštěč nebyl.
    insert into public.profiles (user_id) values (v_spravce), (v_bezny)
      on conflict (user_id) do nothing;
    insert into public.user_roles (user_id, role) values (v_spravce, 'admin');

    -- Sekce deklaruje publikum ROLÍ — tutéž deklaraci čte i zobrazení sekce.
    insert into public.surface_sections (surface, state, audience)
    values (v_sekce, 'active', '{"roles":["admin"]}'::jsonb);

    select array_agg((r ->> 'user_id')::uuid)
      into v_ids
      from jsonb_array_elements(
        public.edge_notification_campaigns(
          'get_section_audience_user_ids',
          jsonb_build_object('section', v_sekce)
        ) -> 'rows'
      ) as t(r);

    if not (v_spravce = any(v_ids)) then
      raise exception 'správce v publiku sekce CHYBÍ';
    end if;
    if v_bezny = any(v_ids) then
      raise exception 'běžný účet se do publika sekce DOSTAL — predikát se obchází';
    end if;

    -- Neznámá sekce: musí vyhodit, ne vrátit prázdno.
    begin
      perform public.edge_notification_campaigns(
        'get_section_audience_user_ids', '{"section":"tahle_sekce_neexistuje"}'::jsonb);
      raise exception 'neznámá sekce NEVYHODILA — překlep by vypadal jako prázdné publikum';
    exception
      when sqlstate '22023' then null;
    end;
  end $$;
rollback;
select 'PUBLIKUM_OK' as vysledek;
`,
      );
      expect(vystup).toContain("PUBLIKUM_OK");
    },
    120_000,
  );
});
