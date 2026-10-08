/**
 * Admin upserty: vynechané pole v aktualizaci NEVRACÍ uloženou hodnotu na výchozí.
 *
 * ⛔ NÁLEZ 2026-10-07: parametry s DEFAULT ≠ NULL + aktualizace
 * `sloupec = COALESCE(p_x, sloupec)`. Vynechaný parametr nebyl NULL, ale výchozí
 * hodnota, takže např. změna stavu veřejného chatu z UI (posílá jen p_id + p_status)
 * vrátila model na gpt-4o-mini, prompt na '' a teplotu na 0.7; u katalogů ikonu,
 * barvu i pořadí. Třídu staticky hlídá brána upsert-vychozi-hodnota-jen-pri-zalozeni;
 * tady se měří chování na skutečné DB (a stará podoba funkce test shodí).
 *
 * K tomu nárok: upsert_public_chat_channel byl SECURITY DEFINER s GRANT pro
 * authenticated a BEZ stráže — kdokoli přihlášený přepsal prompt i webhook.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { fixtura, jako, prihlaseny, zkus } from "./sonda-identity";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const CLEN = randomUUID();
const SLUG = `pgtest-kanal-${RUN}`;
const PRODUKT = `pgtest-produkt-${RUN}`;
const SYMPTOM = `pgtest-symptom-${RUN}`;

const hodnota = (sql: string) => fixtura(sql).trim();

describe.skipIf(!isPgReachable())("admin upserty: výchozí hodnota jen při založení", () => {
  let kanal = "";
  let produkt = "";
  let symptom = "";

  beforeAll(() => {
    fixtura(`INSERT INTO aisha_auth.users (id, email) VALUES
               ('${ADMIN}', 'upsert-admin-${RUN}@test.local'),
               ('${CLEN}',  'upsert-clen-${RUN}@test.local')
             ON CONFLICT (id) DO NOTHING`);
    fixtura(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${CLEN}', 'member')
             ON CONFLICT DO NOTHING`);
  });

  afterAll(() => {
    fixtura(`DELETE FROM public.public_chat_channel_history WHERE channel_id IN (SELECT id FROM public.public_chat_channels WHERE slug = '${SLUG}')`);
    fixtura(`DELETE FROM public.public_chat_channels WHERE slug = '${SLUG}'`);
    fixtura(`DELETE FROM public.product_catalog WHERE code = '${PRODUKT}'`);
    fixtura(`DELETE FROM public.symptom_catalog WHERE code = '${SYMPTOM}'`);
  });

  it("veřejný chat: změna stavu (jen p_id + p_status) nechá model, prompt, teplotu i typ", () => {
    kanal = jako(
      prihlaseny(ADMIN),
      `SELECT public.upsert_public_chat_channel(p_slug => '${SLUG}', p_display_name => 'Kanál ${RUN}',
         p_channel_type => 'telegram', p_model => 'model-${RUN}', p_temperature => 0.2,
         p_max_tokens => 512, p_system_prompt => 'Prompt ${RUN}', p_personality_enabled => false)::text`,
    ).trim();
    expect(kanal).toMatch(/^[0-9a-f-]{36}$/);
    jako(prihlaseny(ADMIN), `SELECT public.upsert_public_chat_channel(p_id => '${kanal}', p_status => 'active')::text`);
    expect(
      hodnota(`SELECT concat_ws('|', status, channel_type, model, temperature, max_tokens, system_prompt, personality_enabled)
                 FROM public.public_chat_channels WHERE id = '${kanal}'`),
    ).toBe(`active|telegram|model-${RUN}|0.2|512|Prompt ${RUN}|f`);
  });

  it("veřejný chat: při založení bez hodnot platí výchozí", () => {
    const novy = jako(
      prihlaseny(ADMIN),
      `SELECT public.upsert_public_chat_channel(p_slug => '${SLUG}-2', p_display_name => 'Druhý ${RUN}')::text`,
    ).trim();
    expect(
      hodnota(`SELECT concat_ws('|', status, channel_type, model, temperature, max_tokens, personality_enabled)
                 FROM public.public_chat_channels WHERE id = '${novy}'`),
    ).toBe("draft|web_widget|gpt-4o-mini|0.7|2048|t");
    fixtura(`DELETE FROM public.public_chat_channel_history WHERE channel_id = '${novy}'`);
    fixtura(`DELETE FROM public.public_chat_channels WHERE id = '${novy}'`);
  });

  it("⛔ veřejný chat smí měnit jen správa — člen ne", () => {
    expect(
      zkus(prihlaseny(CLEN), `SELECT public.upsert_public_chat_channel(p_id => '${kanal}', p_system_prompt => 'podvrh')::text`),
    ).toMatch(/Access denied/);
    expect(hodnota(`SELECT system_prompt FROM public.public_chat_channels WHERE id = '${kanal}'`)).toBe(`Prompt ${RUN}`);
  });

  it("katalog produktů: deaktivace nechá ikonu, barvu, kategorii i pořadí", () => {
    produkt = jako(
      prihlaseny(ADMIN),
      `SELECT public.upsert_product_catalog_admin(p_code => '${PRODUKT}', p_category => 'supplement',
         p_icon => '🧪', p_color => '#123456', p_sort_order => 7)::text`,
    ).trim();
    jako(prihlaseny(ADMIN), `SELECT public.upsert_product_catalog_admin(p_id => '${produkt}', p_is_active => false)::text`);
    expect(
      hodnota(`SELECT concat_ws('|', category, icon, color, sort_order, is_active) FROM public.product_catalog WHERE id = '${produkt}'`),
    ).toBe("supplement|🧪|#123456|7|f");
  });

  it("katalog symptomů: změna pořadí nechá ikonu, barvu, škálu i aktivitu", () => {
    symptom = jako(
      prihlaseny(ADMIN),
      `SELECT public.upsert_symptom_catalog_admin(p_code => '${SYMPTOM}', p_category => 'pain',
         p_icon => '🦴', p_color => '#abcdef', p_default_severity_scale => 10, p_is_active => false)::text`,
    ).trim();
    jako(prihlaseny(ADMIN), `SELECT public.upsert_symptom_catalog_admin(p_id => '${symptom}', p_sort_order => 3)::text`);
    expect(
      hodnota(`SELECT concat_ws('|', category, icon, color, default_severity_scale, sort_order, is_active)
                 FROM public.symptom_catalog WHERE id = '${symptom}'`),
    ).toBe("pain|🦴|#abcdef|10|3|f");
  });
});
