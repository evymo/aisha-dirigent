/**
 * Viditelnost EXPERTNÍCH PRAVIDEL na všech cestách čtení — cesta × identita × sonda, na skutečné databázi.
 *
 * Štítek znamená u pravidel totéž co u znalostí (domov public.knowledge_visibility_searchable):
 * public každý, members přihlášený, guild gilda (G1: schválený konzultant studie + certifikace od
 * správy), private správa. Navíc AUTOR pravidla vidí své pravidlo s jakoukoli viditelností a koncept
 * jen on (stav měří volající funkce). Čtenáři měří viditelnost přes public.expert_rule_visible_to
 * (revize B1, 2026-10-05: detail pravidla vydal anonymovi tělo i pokyny soukromého pravidla; 20+
 * čtenářů rulesetů, compliance, agentů a copilot instrukcí viditelnost nečetlo vůbec).
 *
 * Výjimky z obecného pravidla, které test drží jako pojmenované:
 *  · tabulka napřímo: politiky dávají jen štítek (správa i autor tam žádnou výjimku nemají — čtou přes funkce);
 *  · veřejné výstupy (profil člena gildy, rada dirigenta, výchozí copilot instrukce, výchozí pravidla
 *    instrukcí) vydávají jen to, co je viditelné BEZ identity (`public`), komukoli — i správě;
 *  · čtenáři rulesetu a odběrů stav nefiltrují (koncept připnutý do rulesetu nebo odebíraný ukážou podle
 *    štítku), detail a hledání vydávají jen publikované (autorovi i koncept u detailu).
 *
 * Zapisovatelé návrhů (mcp_propose_improvement, mcp_request_unblock) se měří tím, zda pravidlo NAJDOU; přípravek
 * jim dává cíle cizích klíčů, bez kterých zápis padá dřív, než viditelnost něco rozhodne: agenta
 * `aisha-claude-code` v agent_catalog (seed ho nezakládá) a moderační sezení (bez p_session_id funkce vymyslí
 * id sezení, které neexistuje). Obojí je chyba funkcí mimo viditelnost — pojmenováno v souhrnu.
 *
 * Mimo matici (rozbité nebo nedosažitelné dřív než viditelnost — pojmenováno v souhrnu):
 * assess_code_quality a evaluate_test_strategy filtrují kategorie, které enum expert_rule_category nemá
 * (volání padá); recommend_ruleset_for_story kontroluje vlastníka jako partner_id = auth.uid() (id profilu
 * proti id uživatele). create_story_ruleset má vlastní test níž.
 *
 * Harness: src/tests/db/viditelnost-matice.ts. Běh: npm run test:db:znalosti-cteni.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { type Cesta, type Kdo, KDO, MERENI, maticeText, psql, psqlOk, publikum, stitekPro, vytvorIdentity, zmer } from "./viditelnost-matice";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

type Sonda = { klic: string; vis: string; status: "published" | "draft" };
const SONDY: Sonda[] = [
  { klic: "epub", vis: "public", status: "published" },
  { klic: "emem", vis: "members", status: "published" },
  { klic: "egil", vis: "guild", status: "published" },
  { klic: "epri", vis: "private", status: "published" },
  { klic: "edra", vis: "public", status: "draft" },
  // Pseudo-sonda počtů (statistiky pravidel podle oblasti / autora): hodnota = počet viditelných publikovaných.
  { klic: "pocet", vis: "-", status: "published" },
];
const PRAVIDLA = SONDY.filter((s) => s.klic !== "pocet");
const JEN_PRAVIDLA = (s: Sonda) => s.klic !== "pocet";
const JEN_POCET = (s: Sonda) => s.klic === "pocet";

const BEH = randomUUID().replace(/-/g, "").slice(0, 10);
const I = vytvorIdentity(BEH);
const U = I.U;
const ID: Record<string, string> = Object.fromEntries(PRAVIDLA.map((s) => [s.klic, randomUUID()]));
const OBLAST = randomUUID();
const OBLAST_SLUG = `zkvid-oblast-${BEH}`;
const RULESET = randomUUID();
const AGENT = `zkvid-agent-${BEH}`;
const PROFIL = `zkvid-rs-${BEH}`;
const SEZENI = randomUUID();
/** Agent, kterého mcp_propose_improvement zapisuje do návrhu (FK improvement_proposals.agent_slug → agent_catalog). */
const AGENT_NAVRHU = "aisha-claude-code";
let agentNavrhuZalozen = false;
const slovo = (s: Sonda) => `vr${BEH}${s.klic}`;
const slug = (s: Sonda) => `zkvid-${BEH}-${s.klic}`;
const titulek = (s: Sonda) => `VR${BEH}${s.klic} pravidlo`;
const pub = (kdo: Kdo) => publikum(kdo, U);
const SPRAVCE = () => `'${U.sprava}'::uuid`;

/** Smí identita vidět pravidlo (správa vše, autor své, ostatní štítek) — psáno nezávisle na SQL. */
function vidi(s: Sonda, kdo: Kdo): boolean {
  return kdo === "sprava" || kdo === "autor" || stitekPro(s.vis, kdo) === 1;
}

type CestaP = Cesta<Sonda> & {
  pristup?: (kdo: Kdo) => boolean;
  /** jak cesta rozhoduje: obecně (správa/autor/štítek), jen štítek (tabulka), jen veřejné (bez identity) */
  rezim?: "obecne" | "stitek" | "verejne" | "pocet";
  /** vydává i koncept: "autor" (detail — jen autorovi), "vse" (ruleset/odběry — stav nefiltrují), jinak jen publikované */
  koncept?: "autor" | "vse";
};

const S_PRISTUPEM = (kdo: Kdo) => kdo === "vlastnik" || kdo === "ucastnik" || kdo === "sprava";
const UCASTNIK_SPRAVA = (kdo: Kdo) => kdo === "ucastnik" || kdo === "sprava";
const PRIHLASENI = (kdo: Kdo) => kdo !== "anon";
const vJson = (volani: string, pole: string, s: Sonda) =>
  `SELECT count(*) INTO n FROM jsonb_array_elements(coalesce(${volani}, '[]'::jsonb)) e WHERE e->>'${pole}' = '${s.klic === "pocet" ? "" : pole === "id" || pole === "rule_id" || pole === "expert_rule_id" ? ID[s.klic] : slug(s)}'`;
const vTextu = (volani: string, s: Sonda) => `SELECT CASE WHEN position('${titulek(s)}' IN coalesce(${volani}, '')) > 0 THEN 1 ELSE 0 END INTO n`;
const detail = (fce: string, s: Sonda, dalsi = "") =>
  `SELECT CASE WHEN r->>'slug' = '${slug(s)}' THEN 1 ELSE 0 END INTO n FROM (SELECT public.${fce}(p_rule_slug => '${slug(s)}'${dalsi}) AS r) x`;

const CESTY: CestaP[] = [
  { jmeno: "tabulka expert_rules pod RLS", jako: "role", sondy: JEN_PRAVIDLA, rezim: "stitek", sql: (s) => `SELECT count(*) INTO n FROM public.expert_rules WHERE id = '${ID[s.klic]}'` },
  { jmeno: "get_expert_rule_detail", jako: "role", sondy: JEN_PRAVIDLA, koncept: "autor", sql: (s) => detail("get_expert_rule_detail", s) },
  { jmeno: "get_expert_rule_detail přímo, podvržené publikum = správa", jako: "role", sondy: JEN_PRAVIDLA, koncept: "autor", sql: (s) => detail("get_expert_rule_detail", s, `, p_audience_user_id => ${SPRAVCE()}`) },
  { jmeno: "get_expert_rule_detail služba za identitu", jako: "sluzba", sondy: JEN_PRAVIDLA, koncept: "autor", sql: (s, kdo) => detail("get_expert_rule_detail", s, `, p_audience_user_id => ${pub(kdo)}`) },
  { jmeno: "mcp_get_rule_detail", jako: "role", sondy: JEN_PRAVIDLA, sql: (s) => detail("mcp_get_rule_detail", s) },
  { jmeno: "mcp_get_rule_detail přímo, podvržené publikum = správa", jako: "role", sondy: JEN_PRAVIDLA, sql: (s) => detail("mcp_get_rule_detail", s, `, p_audience_user_id => ${SPRAVCE()}`) },
  { jmeno: "mcp_get_rule_detail služba za identitu", jako: "sluzba", sondy: JEN_PRAVIDLA, sql: (s, kdo) => detail("mcp_get_rule_detail", s, `, p_audience_user_id => ${pub(kdo)}`) },
  {
    jmeno: "get_expert_rules (hledání)",
    jako: "role",
    sondy: JEN_PRAVIDLA,
    sql: (s) => `SELECT count(*) INTO n FROM public.get_expert_rules(p_search => '${slovo(s)}') r WHERE r.slug = '${slug(s)}'`,
  },
  { jmeno: "mcp_search_knowledge (v1)", jako: "role", sondy: JEN_PRAVIDLA, sql: (s) => vJson(`public.mcp_search_knowledge(p_query => '${slovo(s)}')`, "slug", s) },
  { jmeno: "mcp_search_knowledge (v1) služba za identitu", jako: "sluzba", sondy: JEN_PRAVIDLA, sql: (s, kdo) => vJson(`public.mcp_search_knowledge(p_query => '${slovo(s)}', p_audience_user_id => ${pub(kdo)})`, "slug", s) },
  { jmeno: "generate_copilot_instructions (ruleset příběhu)", jako: "role", sondy: JEN_PRAVIDLA, pristup: S_PRISTUPEM, sql: (s) => vTextu(`(SELECT public.generate_copilot_instructions('${I.pribeh}'::uuid))`, s) },
  { jmeno: "get_instruction_payload (ruleset příběhu)", jako: "role", sondy: JEN_PRAVIDLA, pristup: PRIHLASENI, sql: (s) => vJson(`public.get_instruction_payload('${I.pribeh}'::uuid)->'rules'`, "slug", s) },
  {
    jmeno: "get_story_knowledge_context (štítky + odběry)",
    jako: "role",
    sondy: JEN_PRAVIDLA,
    pristup: PRIHLASENI,
    sql: (s) => `SELECT count(*) INTO n FROM public.get_story_knowledge_context('${I.pribeh}'::uuid, ARRAY['${slovo(s)}']) r WHERE r.id = '${ID[s.klic]}'`,
  },
  { jmeno: "get_story_rulesets", jako: "role", sondy: JEN_PRAVIDLA, pristup: UCASTNIK_SPRAVA, koncept: "vse", sql: (s) => `SELECT count(*) INTO n FROM public.get_story_rulesets('${I.pribeh}'::uuid) r, jsonb_array_elements(r.rules) e WHERE e->>'rule_id' = '${ID[s.klic]}'` },
  { jmeno: "mcp_get_compliance_context (ruleset příběhu)", jako: "role", sondy: JEN_PRAVIDLA, pristup: S_PRISTUPEM, sql: (s) => vJson(`public.mcp_get_compliance_context('${I.pribeh}'::uuid)->'ruleset'->'rules'`, "slug", s) },
  // Metadata příběhu jen s přístupem k příběhu (can_access_story) — do 2026-10-06 je dostal kdokoli přihlášený.
  { jmeno: "mcp_get_story_context (náhled rulesetu)", jako: "role", sondy: JEN_PRAVIDLA, pristup: S_PRISTUPEM, sql: (s) => vJson(`public.mcp_get_story_context('${I.pribeh}'::uuid)->'rules_preview'`, "slug", s) },
  {
    jmeno: "moderate_development_flow (připnutá pravidla příběhu)",
    jako: "role",
    sondy: JEN_PRAVIDLA,
    pristup: S_PRISTUPEM,
    sql: (s) => vJson(`public.moderate_development_flow('pr_review', '${I.pribeh}'::uuid)->'rules'`, "slug", s),
  },
  { jmeno: "mcp_get_agent_knowledge", jako: "role", sondy: JEN_PRAVIDLA, pristup: PRIHLASENI, sql: (s) => `SELECT count(*) INTO n FROM public.mcp_get_agent_knowledge('${AGENT}') r WHERE r.id = '${ID[s.klic]}'` },
  {
    jmeno: "mcp_get_agent_knowledge služba za identitu",
    jako: "sluzba",
    sondy: JEN_PRAVIDLA,
    sql: (s, kdo) => `SELECT count(*) INTO n FROM public.mcp_get_agent_knowledge('${AGENT}', NULL, ${pub(kdo)}) r WHERE r.id = '${ID[s.klic]}'`,
  },
  {
    jmeno: "list_agent_kb_bindings",
    jako: "role",
    sondy: JEN_PRAVIDLA,
    pristup: UCASTNIK_SPRAVA,
    koncept: "vse",
    sql: (s) => `SELECT count(*) INTO n FROM public.list_agent_kb_bindings('${I.pribeh}'::uuid, '${AGENT}') r WHERE r.knowledge_item_id = '${ID[s.klic]}'`,
  },
  { jmeno: "get_my_rule_subscriptions", jako: "role", sondy: JEN_PRAVIDLA, pristup: PRIHLASENI, koncept: "vse", sql: (s) => `SELECT count(*) INTO n FROM public.get_my_rule_subscriptions() r WHERE r.expert_rule_id = '${ID[s.klic]}'` },
  { jmeno: "get_guild_member_detail (profil autora)", jako: "role", sondy: JEN_PRAVIDLA, rezim: "verejne", sql: (s) => `SELECT count(*) INTO n FROM public.get_guild_member_detail('${I.autorPartner}'::uuid) d, jsonb_array_elements(d.published_rules) e WHERE e->>'id' = '${ID[s.klic]}'` },
  { jmeno: "mcp_consult_dirigent", jako: "role", sondy: JEN_PRAVIDLA, rezim: "verejne", sql: (s) => vJson(`public.mcp_consult_dirigent('${slovo(s)}')->'evidence_rules'`, "slug", s) },
  { jmeno: "generate_default_copilot_instructions", jako: "role", sondy: JEN_PRAVIDLA, rezim: "verejne", sql: (s) => vTextu("(SELECT public.generate_default_copilot_instructions())", s) },
  {
    jmeno: "compose_context vrstva ruleset (za žadatele, příběh)",
    jako: "sluzba",
    sondy: JEN_PRAVIDLA,
    pristup: S_PRISTUPEM,
    sql: (s, kdo) => vJson(`public.compose_context('${I.pribeh}'::uuid, '${PROFIL}', NULL::uuid, NULL::text, NULL::text, ${pub(kdo)})->'layers'->'ruleset'->'rules'`, "slug", s),
  },
  {
    jmeno: "mcp_propose_improvement (pravidlo nalezeno)",
    jako: "role",
    sondy: JEN_PRAVIDLA,
    pristup: PRIHLASENI,
    koncept: "vse",
    sql: (s) => `SELECT CASE WHEN r ? 'error' THEN 0 ELSE 1 END INTO n FROM (SELECT public.mcp_propose_improvement('${ID[s.klic]}'::uuid, 'zk návrh') AS r) x`,
  },
  {
    jmeno: "mcp_request_unblock (pravidlo nalezeno)",
    jako: "role",
    sondy: JEN_PRAVIDLA,
    pristup: PRIHLASENI,
    koncept: "vse",
    sql: (s) => `SELECT CASE WHEN r ? 'error' THEN 0 ELSE 1 END INTO n FROM (SELECT public.mcp_request_unblock('${ID[s.klic]}'::uuid, 'zk odůvodnění', '${SEZENI}'::uuid) AS r) x`,
  },
  { jmeno: "get_expertise_areas (počet pravidel oblasti)", jako: "role", sondy: JEN_POCET, rezim: "pocet", sql: () => `SELECT coalesce((SELECT a.rule_count FROM public.get_expertise_areas() a WHERE a.slug = '${OBLAST_SLUG}'), -1) INTO n` },
  {
    jmeno: "mcp_get_expertise_areas (počet pravidel oblasti)",
    jako: "role",
    sondy: JEN_POCET,
    rezim: "pocet",
    sql: () => `SELECT coalesce((SELECT (e->>'rule_count')::int FROM jsonb_array_elements(public.mcp_get_expertise_areas()) e WHERE e->>'slug' = '${OBLAST_SLUG}'), -1) INTO n`,
  },
  {
    jmeno: "get_guild_members (počet pravidel autora)",
    jako: "role",
    sondy: JEN_POCET,
    rezim: "pocet",
    sql: () => `SELECT coalesce((SELECT g.rules_count FROM public.get_guild_members(p_expertise_slug => '${OBLAST_SLUG}') g WHERE g.id = '${I.autorPartner}'), -1) INTO n`,
  },
  {
    jmeno: "mcp_match_experts (počet pravidel autora)",
    jako: "role",
    sondy: JEN_POCET,
    rezim: "pocet",
    sql: () =>
      `SELECT coalesce((SELECT (e->>'published_rules_count')::int FROM jsonb_array_elements(public.mcp_match_experts(p_expertise_slug => '${OBLAST_SLUG}')) e WHERE e->>'partner_id' = '${I.autorPartner}'), -1) INTO n`,
  },
];

function ocekavani(c: CestaP, s: Sonda, kdo: Kdo): string {
  if (c.pristup && !c.pristup(kdo)) return "odepreno";
  if (c.rezim === "pocet") return String(PRAVIDLA.filter((p) => p.status === "published" && vidi(p, kdo)).length);
  if (c.rezim === "verejne") return s.status === "published" && s.vis === "public" ? "1" : "0";
  if (c.rezim === "stitek") return s.status === "published" && stitekPro(s.vis, kdo) === 1 && kdo !== "sprava" ? "1" : s.status === "published" && kdo === "sprava" && ["public", "members"].includes(s.vis) ? "1" : "0";
  const stavOk = s.status === "published" || c.koncept === "vse" || (c.koncept === "autor" && kdo === "autor");
  return stavOk && vidi(s, kdo) ? "1" : "0";
}
const ocekavaneMapa = (kdo: Kdo) =>
  Object.fromEntries(CESTY.flatMap((c) => SONDY.filter(c.sondy).map((s) => [`${c.jmeno}|${s.klic}`, ocekavani(c, s, kdo)])));

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("viditelnost expertních pravidel: cesta × identita × sonda", () => {
  const namereno: Partial<Record<Kdo, Record<string, string>>> = {};

  beforeAll(() => {
    if (!isPgReachable()) throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    const pravidla = PRAVIDLA.map(
      (s) =>
        `('${ID[s.klic]}', '${slug(s)}', '${titulek(s)}', 'souhrn ${slovo(s)}', 'tělo ${s.klic}', 'pokyn ${slovo(s)}', 'coding_standard', '${s.status}', '${s.vis}', '${I.autorPartner}', '${OBLAST}', ARRAY['${slovo(s)}'], true, ${s.status === "published" ? "now()" : "NULL"})`,
    );
    const odbery = KDO.filter((k) => U[k]).flatMap((k) => PRAVIDLA.map((s) => `('${U[k]}', '${ID[s.klic]}', true)`));
    agentNavrhuZalozen =
      psqlOk(`INSERT INTO public.agent_catalog (slug, display_name, purpose, default_model) VALUES ('${AGENT_NAVRHU}', 'ZKV agent návrhů', 'zk', 'zk')
  ON CONFLICT (slug) DO NOTHING RETURNING 'zalozen';`) === "zalozen";
    psqlOk(`${I.sql}
INSERT INTO public.moderation_sessions (id, user_id, session_type) VALUES ('${SEZENI}', '${U.sprava}', 'zkvid');
UPDATE public.partner_profiles SET is_visible = true, guild_tier = 'apprentice' WHERE id = '${I.autorPartner}';
INSERT INTO public.guild_expertise_areas (id, slug, name_key, is_active) VALUES ('${OBLAST}', '${OBLAST_SLUG}', 'zk.oblast', true);
INSERT INTO public.guild_member_expertise (partner_id, expertise_area_id, proficiency_level) VALUES ('${I.autorPartner}', '${OBLAST}', 5);
INSERT INTO public.expert_rules (id, slug, title, summary, body_markdown, ai_instructions, category, status, visibility, author_partner_id, expertise_area_id, ai_context_tags, is_default, published_at)
  VALUES ${pravidla.join(",\n         ")};
INSERT INTO public.story_rulesets (id, story_id, ruleset_fingerprint, rule_ids, rule_versions, context_profile)
  VALUES ('${RULESET}', '${I.pribeh}', 'zkvid-${BEH}', ARRAY[${PRAVIDLA.map((s) => `'${ID[s.klic]}'`).join(", ")}]::uuid[], '{}'::jsonb, '${PROFIL}');
INSERT INTO public.story_contexts (story_id, ruleset_id) VALUES ('${I.pribeh}', '${RULESET}')
  ON CONFLICT (story_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id;
INSERT INTO public.agent_knowledge_bindings (agent_slug, knowledge_item_id, binding_type, priority, is_active, story_id)
  VALUES ${PRAVIDLA.map((s) => `('${AGENT}', '${ID[s.klic]}', 'rule', 1, true, NULL)`).join(", ")};
INSERT INTO public.expert_rule_subscriptions (user_id, rule_id, is_active) VALUES ${odbery.join(", ")};
INSERT INTO public.context_profiles (slug, display_name, layers, token_budget, priority_order, is_active)
  VALUES ('${PROFIL}', 'ZKV RS ${BEH}', '{"ruleset": {"enabled": true, "max_rules": 50, "include_body": false}}'::jsonb, 100000, ARRAY['ruleset']::text[], true);`);
    for (const kdo of KDO) namereno[kdo] = zmer(CESTY, SONDY, kdo, U);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    const ids = PRAVIDLA.map((s) => `'${ID[s.klic]}'`).join(", ");
    psqlOk(`RESET ROLE;
DELETE FROM public.improvement_proposals WHERE metadata->>'rule_id' IN (${PRAVIDLA.map((s) => `'${ID[s.klic]}'`).join(", ")});
DELETE FROM public.moderation_sessions WHERE id = '${SEZENI}';
${agentNavrhuZalozen ? `DELETE FROM public.agent_catalog WHERE slug = '${AGENT_NAVRHU}';` : ""}
DELETE FROM public.context_profiles WHERE slug = '${PROFIL}';
DELETE FROM public.agent_knowledge_bindings WHERE agent_slug = '${AGENT}';
DELETE FROM public.story_contexts WHERE story_id = '${I.pribeh}';
DELETE FROM public.story_rulesets WHERE story_id = '${I.pribeh}';
DELETE FROM public.knowledge_items WHERE source_id IN (${ids});
DELETE FROM public.expert_rules WHERE id IN (${ids});
DELETE FROM public.guild_member_expertise WHERE expertise_area_id = '${OBLAST}';
DELETE FROM public.guild_expertise_areas WHERE id = '${OBLAST}';
${I.uklid}`);
  });

  if (MERENI) {
    it("režim měření: matice cesta × sonda × identita (bez tvrzení)", () => {
      const text = maticeText(CESTY, SONDY, namereno);
      console.log(text);
      expect(text.split("\n").length).toBeGreaterThan(3);
    });
    return;
  }

  it("kotva: správa a autor dostanou na obecných cestách i soukromé pravidlo; každá cesta umí sondu vrátit", () => {
    for (const kdo of ["sprava", "autor"] as Kdo[]) {
      for (const c of CESTY) {
        if (c.pristup && !c.pristup(kdo)) continue;
        expect(SONDY.filter(c.sondy).some((s) => namereno[kdo]![`${c.jmeno}|${s.klic}`] !== "0"), `${c.jmeno}: ${kdo} nedostal nic`).toBe(true);
      }
    }
    expect(namereno.sprava).toEqual(ocekavaneMapa("sprava"));
  });

  it("kotva gildy: schválený a certifikovaný konzultant dostane pravidlo `guild`; konzultant bez certifikace a vlastní profil ne", () => {
    expect(namereno.gilda!["get_expert_rule_detail|egil"]).toBe("1");
    expect(namereno.konzultant!["get_expert_rule_detail|egil"]).toBe("0");
    expect(namereno.profil!["get_expert_rule_detail|egil"]).toBe("0");
  });

  for (const kdo of KDO.filter((k) => k !== "sprava")) {
    it(`${kdo}: každá cesta vydá přesně to, co smí (ani víc, ani míň)`, () => {
      expect(namereno[kdo]).toEqual(ocekavaneMapa(kdo));
    });
  }

  it("create_story_ruleset přijme jen pravidlo viditelné pro volajícího (jinak 42501)", () => {
    // Kontrola vlastníka v create_story_ruleset porovnává partner_stories.partner_id s auth.uid(): vlastník
    // proto dostane profil partnera s id rovným svému id uživatele (platná data, jen jinak neobvyklá).
    const [kdo, pribeh] = [randomUUID(), randomUUID()];
    const pod = (pravidlo: string) => `BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('${kdo}', 'zkvid-rs-${kdo}@test.local');
INSERT INTO public.partner_profiles (id, user_id, display_name, city) VALUES ('${kdo}', '${kdo}', 'ZKV vlastník rulesetu', 'Brno');
INSERT INTO public.partner_stories (id, title, user_id, partner_id) VALUES ('${pribeh}', 'ZKV ruleset ${BEH}', '${kdo}', '${kdo}');
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${kdo}"}', true);
SET LOCAL ROLE authenticated;
SELECT 'vysledek=' || (public.create_story_ruleset('${pribeh}'::uuid, ARRAY['${pravidlo}']::uuid[])->>'ruleset_id' IS NOT NULL)::text;
ROLLBACK;`;
    const verejne = psql(pod(ID.epub));
    expect(verejne.kod, verejne.chyba).toBe(0);
    expect(verejne.vystup).toContain("vysledek=true");
    const soukrome = psql(pod(ID.epri));
    expect(soukrome.kod).not.toBe(0);
    expect(soukrome.chyba).toMatch(/not visible to the caller/);
  });
});
