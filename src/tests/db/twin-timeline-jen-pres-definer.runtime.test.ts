/**
 * audience_admin_twin_timeline_v se čte JEN přes get_audience_view_timeline_block.
 *
 * ⛔ NÁLEZ 2026-10-04 (revize SQL): pohled se čte právy VLASTNÍKA (mimo RLS
 * story_entries a twin_events — včetně `is_internal` záznamů a předmětů
 * e-mailů z ingestu), a heals mu dal `GRANT SELECT … TO authenticated`.
 * Stráž is_admin_or_staff() v blokové funkci tak šla obejít přímým
 * /rest/v1/audience_admin_twin_timeline_v — řidič bez rolí četl osu kohokoli.
 *
 * Kontrolní vzorek: admin přes blokovou funkci stopu VIDÍ. Bez toho by
 * „člen nic nečte" mohlo znamenat jen prázdnou osu.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { ANON, SLUZBA, fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const RIDIC = randomUUID();
const TWIN = randomUUID();
const PREDMET = `Výpověď smlouvy ${RUN}`;

const PRIMO = `SELECT coalesce(string_agg(content, ','), '') FROM public.audience_admin_twin_timeline_v WHERE twin_id = '${TWIN}'`;
const BLOK = `SELECT public.get_audience_view_timeline_block('${JSON.stringify({
  view: "audience_admin_twin_timeline_v",
  at_src: "occurred_at",
  label_src: "content",
  filters: [{ src: "twin_id", param: "twin_id" }],
  twin_id: TWIN,
})}'::jsonb)::text`;

describe.skipIf(!isPgReachable())("osa dvojčete: jen přes DEFINER blok se strážemi", () => {
  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}', 'osa-admin-${RUN}@test.local'),
               ('${RIDIC}', 'osa-ridic-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${RIDIC}', 'member')
             ON CONFLICT DO NOTHING`);
    fixtura(`INSERT INTO public.twin_entities (id, entity_type, label) VALUES ('${TWIN}', 'person', 'Osa ${RUN}')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.twin_events (event_type, twin_id, occurred_at, source, attrs)
             VALUES ('email', '${TWIN}', now(), 'osa-${RUN}', '{"subject": "${PREDMET}"}'::jsonb)`);
  });

  it("admin přes blokovou funkci stopu vidí (kontrolní vzorek)", () => {
    expect(jako(prihlaseny(ADMIN), BLOK), "admin nevidí ani fixturu — sonda je slepá").toContain(PREDMET);
  });

  it("člen přes blokovou funkci nedostane nic (stráž funkce)", () => {
    expect(jako(prihlaseny(RIDIC), BLOK)).not.toContain(PREDMET);
  });

  it("⛔ člen NEobejde stráž přímým čtením pohledu", () => {
    expect(zkus(prihlaseny(RIDIC), PRIMO)).toMatch(/permission denied for view audience_admin_twin_timeline_v/);
  });

  it("⛔ přímé čtení nemá ani admin — jediná cesta je bloková funkce", () => {
    expect(zkus(prihlaseny(ADMIN), PRIMO)).toMatch(/permission denied for view audience_admin_twin_timeline_v/);
  });

  it("anon nečte nic, služba ano", () => {
    expect(zkus(ANON, PRIMO)).toMatch(/permission denied for view audience_admin_twin_timeline_v/);
    expect(jako(SLUZBA, PRIMO)).toContain(PREDMET);
  });
});
