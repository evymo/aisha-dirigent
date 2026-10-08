/**
 * Čtení podle id PŘÍBĚHU a BĚHU jen s přístupem — a nepřihlášený jen `public` — na skutečné databázi.
 *
 * Nálezy nezávislé revize (zahazovací DB nad mainem 8b7637acc, 2026-10-05), každý měřený tady jako
 * cesta × identita × sonda pod rolí API (SET ROLE + značky JWT jako PostgREST):
 *   1. mcp_get_story_context(uuid) vydal KOMUKOLI přihlášenému metadata cizího příběhu (repo,
 *      účastníky, env_hints, mcp_endpoint). Teď jen tomu, kdo smí na příběh (can_access_story):
 *      vlastník, účastník, správa, služba. Cizí i neexistující příběh vypadají stejně (42501).
 *   2. vrstva `memory` v compose_context četla ai_trace_events libovolného p_run_id. Teď jen běh,
 *      který smí číst ten, PRO KOHO se skládá (fn_user_can_read_run); služba bez žadatele smí vše.
 *   4. politika graph_nodes vydala přihlášenému štítky všech globálních uzlů a všech uzlů výchozího
 *      příběhu — i soukromých položek a pravidel (uzel nese titulek zdroje). Teď uzel položky znalostí
 *      a expertního pravidla vidí jen ten, kdo smí číst ZDROJOVÝ řádek napřímo (politiky knowledge_items
 *      a expert_rules = domov viditelnosti v podobě pro politiky); ostatní uzly jen vlastník a účastník
 *      příběhu uzlu; globální uzel bez zdroje znalostí jen správa.
 *   5. get_product_transparency vydal anonymovi témata s viditelností `members`. Teď téma jen podle
 *      domova knowledge_visibility_searchable: nepřihlášený `public`, přihlášený `public` + `members`.
 * Nález 3 (vrstva `ruleset` bez viditelnosti pravidel) na mainu 6bd3924ff už neplatí — opravil ho
 * d35e0b795 a měří ho matice pravidel (src/tests/db/pravidla-viditelnost-cesta-identita, cesta
 * „compose_context vrstva ruleset“).
 *
 * Očekávání je psané nezávisle na SQL (tabulky níž). Harness: src/tests/db/viditelnost-matice.ts.
 * Režim měření (tabulka před/po bez tvrzení): ZKV_MERENI=1.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import { type Cesta, type Kdo, KDO, MERENI, S_PRISTUPEM, maticeText, psqlOk, publikum, vytvorIdentity, zmer } from "./viditelnost-matice";

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

const BEH = randomUUID().replace(/-/g, "").slice(0, 10);
const I = vytvorIdentity(BEH);
const U = I.U;
const pub = (kdo: Kdo) => publikum(kdo, U);
const S_PRISTUPEM_F = (kdo: Kdo) => S_PRISTUPEM.includes(kdo);

/** Cizí příběh (vlastní ho správa — žádná jiná identita k němu přístup nemá) a dva běhy. */
const CIZI_PRIBEH = randomUUID();
const BEH_P = randomUUID(); // běh v příběhu sond
const BEH_C = randomUUID(); // běh v cizím příběhu
const NEEXISTUJICI = randomUUID();
const PROFIL = `zkpb-${BEH}`;
/** Profil jen s vrstvou project_context (skládání bez příběhu nesmí kvůli stráži příběhu spadnout). */
const PROFIL_PROJEKT = `zkpb-projekt-${BEH}`;
/** Značky citlivých metadat příběhu: najdou se v odpovědi jen tehdy, když ji funkce vydala. */
const ZNACKA = {
  repo: `https://repo.invalid/zkpb-${BEH}`,
  env: `zkpb-env-${BEH}`,
  mcp: `https://mcp.invalid/zkpb-${BEH}`,
  op: `zkpb-op-${BEH}`,
  opCizi: `zkpb-op-cizi-${BEH}`,
};

// ── Sondy ──────────────────────────────────────────────────────────────────────
type Sonda = { klic: string; skupina: "pribeh" | "pamet" | "projekt" | "graf" | "temata" };
const S = (klic: string, skupina: Sonda["skupina"]): Sonda => ({ klic, skupina });

/** Uzly grafu: co nesou a kde žijí. */
type Uzel = {
  klic: string;
  typ: "KnowledgeItem" | "ExpertRule" | "Concept" | "Memory";
  /** položka znalostí / pravidlo, ze které uzel nese titulek (null = bez zdroje znalostí) */
  zdroj: null | { tabulka: "knowledge_items"; vis: string; pribeh: null | "pribeh" | "vychozi" } | { tabulka: "expert_rules"; vis: string };
  /** příběh uzlu (graph_nodes.story_id) */
  pribeh: null | "pribeh" | "vychozi";
};
const UZLY: Uzel[] = [
  { klic: "kgpub", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "public", pribeh: null }, pribeh: null },
  { klic: "kgmem", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "members", pribeh: null }, pribeh: null },
  { klic: "kggil", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "guild", pribeh: null }, pribeh: null },
  { klic: "kgpri", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "private", pribeh: null }, pribeh: null },
  // KOTVA NÁLEZU 4: soukromá položka výchozího příběhu (uzel nese její titulek)
  { klic: "kdpri", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "private", pribeh: "vychozi" }, pribeh: "vychozi" },
  { klic: "kdpub", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "public", pribeh: "vychozi" }, pribeh: "vychozi" },
  { klic: "kppri", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "private", pribeh: "pribeh" }, pribeh: "pribeh" },
  // Uzel položky, který služba zapsala do JINÉHO příběhu než položka: rozhoduje položka, ne příběh uzlu.
  { klic: "kgprivp", typ: "KnowledgeItem", zdroj: { tabulka: "knowledge_items", vis: "private", pribeh: null }, pribeh: "pribeh" },
  { klic: "erpub", typ: "ExpertRule", zdroj: { tabulka: "expert_rules", vis: "public" }, pribeh: null },
  { klic: "erpri", typ: "ExpertRule", zdroj: { tabulka: "expert_rules", vis: "private" }, pribeh: null },
  { klic: "cpribeh", typ: "Concept", zdroj: null, pribeh: "pribeh" },
  { klic: "cvychozi", typ: "Concept", zdroj: null, pribeh: "vychozi" },
  { klic: "cglobal", typ: "Concept", zdroj: null, pribeh: null },
  { klic: "mglobal", typ: "Memory", zdroj: null, pribeh: null },
];
const TEMATA: { klic: string; vis: "public" | "members" | "internal" }[] = [
  { klic: "tpub", vis: "public" },
  { klic: "tmem", vis: "members" },
  { klic: "tint", vis: "internal" },
];

const SONDY: Sonda[] = [
  ...["repo", "env", "mcp", "ucastnik"].map((k) => S(k, "pribeh")),
  S("neexistujici", "pribeh"),
  S("udalosti", "pamet"),
  S("bezpribehu", "projekt"),
  ...UZLY.map((u) => S(u.klic, "graf")),
  ...TEMATA.map((t) => S(t.klic, "temata")),
];
const ID_UZLU: Record<string, string> = Object.fromEntries(UZLY.map((u) => [u.klic, randomUUID()]));
const ID_ZDROJE: Record<string, string> = Object.fromEntries(UZLY.map((u) => [u.klic, randomUUID()]));
const ID_TEMATU: Record<string, string> = Object.fromEntries(TEMATA.map((t) => [t.klic, randomUUID()]));
const PRODUKT = randomUUID();
const PRODUKT_SLUG = `zkpb-produkt-${BEH}`;
const slugTematu = (klic: string) => `zkpb-${BEH}-${klic}`;
let VYCHOZI = "";

// ── Cesty ──────────────────────────────────────────────────────────────────────
type CestaB = Cesta<Sonda> & {
  /** Očekávání podle pravidla, psané nezávisle na SQL. */
  ocekavani: (s: Sonda, kdo: Kdo) => string;
};

/** Odpověď mcp_get_story_context: 1 = citlivé metadatum v ní je. */
const kontextPribehu = (pribeh: string, s: Sonda) => {
  const hledane: Record<string, string> = { repo: ZNACKA.repo, env: ZNACKA.env, mcp: ZNACKA.mcp, ucastnik: U.ucastnik ?? "" };
  if (s.klic === "neexistujici") {
    // neexistující příběh: 1 = funkce odpověděla daty (ne chybou)
    return `SELECT CASE WHEN r ? 'error' THEN 0 ELSE 1 END INTO n FROM (SELECT public.mcp_get_story_context('${NEEXISTUJICI}'::uuid) AS r) x`;
  }
  return `SELECT CASE WHEN position('${hledane[s.klic]}' IN r::text) > 0 THEN 1 ELSE 0 END INTO n FROM (SELECT public.mcp_get_story_context('${pribeh}'::uuid) AS r) x`;
};
/** Vrstva paměti v compose_context: 1 = událost běhu se značkou v ní je. */
const pamet = (pribeh: string, beh: string, znacka: string, zadatel: string) =>
  `SELECT LEAST(1, count(*)) INTO n
     FROM jsonb_array_elements(coalesce(public.compose_context(${pribeh}, '${PROFIL}', '${beh}'::uuid, NULL::text, NULL::text, ${zadatel})->'layers'->'memory'->'events', '[]'::jsonb)) e
    WHERE e->>'operation' = '${znacka}'`;

const odepreno = "odepreno";
const PRIBEH_SOND = (s: Sonda) => s.skupina === "pribeh" && s.klic !== "neexistujici";

/** Uzel grafu napřímo (tabulka pod RLS) — pravidlo: uzel nese titulek zdroje, vidí ho, kdo smí číst zdroj. */
function uzelPro(u: Uzel, kdo: Kdo): string {
  if (kdo === "anon") return odepreno; // graph_nodes anonym nečte vůbec (bez práva SELECT)
  if (kdo === "sprava") return "1";
  const stitek = (vis: string) => vis === "public" || vis === "members" || (vis === "guild" && kdo === "gilda");
  if (u.zdroj?.tabulka === "knowledge_items") {
    // Položka příběhu: vlastník a účastník. Položka výchozího příběhu: jen jeho vlastník a účastník
    // (tabulka knowledge_items výchozí příběh nikomu dalšímu neotvírá). Globální: podle štítku.
    if (u.zdroj.pribeh === "pribeh") return S_PRISTUPEM_F(kdo) ? "1" : "0";
    if (u.zdroj.pribeh === "vychozi") return "0";
    return stitek(u.zdroj.vis) ? "1" : "0";
  }
  if (u.zdroj?.tabulka === "expert_rules") return stitek(u.zdroj.vis) ? "1" : "0";
  // Uzel bez zdroje znalostí: patří příběhu uzlu (vlastník, účastník); globální jen správě.
  if (u.pribeh === "pribeh") return S_PRISTUPEM_F(kdo) ? "1" : "0";
  return "0";
}

const CESTY: CestaB[] = [
  // ── nález 1: metadata příběhu podle id ──
  {
    jmeno: "mcp_get_story_context (příběh sond)",
    jako: "role",
    sondy: (s) => s.skupina === "pribeh",
    sql: (s) => kontextPribehu(I.pribeh, s),
    ocekavani: (s, kdo) => {
      if (s.klic === "neexistujici") return kdo === "sprava" ? "0" : odepreno; // cizí i neexistující = totéž
      return S_PRISTUPEM_F(kdo) ? "1" : odepreno;
    },
  },
  {
    jmeno: "mcp_get_story_context služba",
    jako: "sluzba",
    sondy: PRIBEH_SOND,
    sql: (s) => kontextPribehu(I.pribeh, s),
    ocekavani: () => "1",
  },
  // ── nález 2: paměť běhu podle id ──
  {
    jmeno: "compose_context paměť běhu, přímo, bez příběhu",
    jako: "role",
    sondy: (s) => s.skupina === "pamet",
    sql: () => pamet("NULL::uuid", BEH_P, ZNACKA.op, "NULL::uuid"),
    ocekavani: (_s, kdo) => (S_PRISTUPEM_F(kdo) ? "1" : odepreno),
  },
  {
    // Přihlášený jmenuje jako žadatele správce: počítá se on sám.
    jmeno: "compose_context paměť běhu, přímo, podstrčený žadatel = správa",
    jako: "role",
    sondy: (s) => s.skupina === "pamet",
    sql: () => pamet("NULL::uuid", BEH_P, ZNACKA.op, `'${U.sprava}'::uuid`),
    ocekavani: (_s, kdo) => (S_PRISTUPEM_F(kdo) ? "1" : odepreno),
  },
  {
    // Vlastní příběh projde kontrolou příběhu — běh z CIZÍHO příběhu ale ne.
    jmeno: "compose_context paměť cizího běhu přes vlastní příběh",
    jako: "role",
    sondy: (s) => s.skupina === "pamet",
    sql: () => pamet(`'${I.pribeh}'::uuid`, BEH_C, ZNACKA.opCizi, "NULL::uuid"),
    ocekavani: (_s, kdo) => (kdo === "sprava" ? "1" : odepreno),
  },
  {
    jmeno: "compose_context paměť běhu, služba za žadatele",
    jako: "sluzba",
    sondy: (s) => s.skupina === "pamet",
    sql: (_s, kdo) => pamet("NULL::uuid", BEH_P, ZNACKA.op, pub(kdo)),
    // služba bez žadatele (sloupec anon) smí vše; za žadatele rozhoduje jeho přístup k běhu
    ocekavani: (_s, kdo) => (kdo === "anon" || S_PRISTUPEM_F(kdo) ? "1" : odepreno),
  },
  {
    jmeno: "compose_context paměť cizího běhu, služba za žadatele s vlastním příběhem",
    jako: "sluzba",
    sondy: (s) => s.skupina === "pamet",
    sql: (_s, kdo) => pamet(`'${I.pribeh}'::uuid`, BEH_C, ZNACKA.opCizi, pub(kdo)),
    // bez žadatele odmítne už kontrola příběhu (skládání v příběhu žadatele vyžaduje)
    ocekavani: (_s, kdo) => (kdo === "sprava" ? "1" : odepreno),
  },
  {
    // Vrstva project_context bez příběhu se přeskočí (dřív do svazku vložila {"error": "Story not found"});
    // se stráží v mcp_get_story_context by jinak skládání bez příběhu spadlo na 42501.
    jmeno: "compose_context bez příběhu, vrstva project_context",
    jako: "role",
    sondy: (s) => s.skupina === "projekt",
    sql: () =>
      `SELECT CASE WHEN c ? 'layers' AND NOT (c->'layers' ? 'project_context') THEN 1 ELSE 0 END INTO n
         FROM (SELECT public.compose_context(NULL::uuid, '${PROFIL_PROJEKT}', NULL::uuid, NULL::text, NULL::text, NULL::uuid) AS c) x`,
    ocekavani: (_s, kdo) => (kdo === "anon" ? odepreno : "1"),
  },
  // ── nález 4: uzly grafu napřímo ──
  {
    jmeno: "tabulka graph_nodes pod RLS",
    jako: "role",
    sondy: (s) => s.skupina === "graf",
    sql: (s) => `SELECT count(*) INTO n FROM public.graph_nodes WHERE id = '${ID_UZLU[s.klic]}'`,
    ocekavani: (s, kdo) => uzelPro(UZLY.find((u) => u.klic === s.klic)!, kdo),
  },
  // ── nález 5: témata transparentnosti produktu ──
  {
    jmeno: "get_product_transparency (témata)",
    jako: "role",
    sondy: (s) => s.skupina === "temata",
    sql: (s) =>
      `SELECT count(*) INTO n FROM jsonb_array_elements(public.get_product_transparency('${PRODUKT_SLUG}')->'knowledge_topics') e WHERE e->>'slug' = '${slugTematu(s.klic)}'`,
    ocekavani: (s, kdo) => {
      const vis = TEMATA.find((t) => t.klic === s.klic)!.vis;
      if (vis === "public") return "1";
      if (vis === "members") return kdo === "anon" ? "0" : "1";
      return "0"; // internal na veřejné stránce produktu nikdy
    },
  },
];

const ocekavaneMapa = (kdo: Kdo) => Object.fromEntries(CESTY.flatMap((c) => SONDY.filter(c.sondy).map((s) => [`${c.jmeno}|${s.klic}`, c.ocekavani(s, kdo)])));

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("čtení podle id příběhu a běhu: cesta × identita × sonda", () => {
  const namereno: Partial<Record<Kdo, Record<string, string>>> = {};

  beforeAll(() => {
    if (!isPgReachable()) throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    VYCHOZI = psqlOk("SELECT id FROM public.partner_stories WHERE is_stack_default = true ORDER BY created_at LIMIT 1");
    if (!VYCHOZI) throw new Error("databáze nemá výchozí příběh instance (ensure_stack_default_story) — uzly výchozího příběhu nemají kam");
    const pribeh = (p: null | "pribeh" | "vychozi") => (p === "pribeh" ? `'${I.pribeh}'` : p === "vychozi" ? `'${VYCHOZI}'` : "NULL");
    const polozky = UZLY.filter((u) => u.zdroj?.tabulka === "knowledge_items").map((u) => {
      const z = u.zdroj as { vis: string; pribeh: null | "pribeh" | "vychozi" };
      return `('${ID_ZDROJE[u.klic]}', 'domain_doc', 'manual', 'zkpb-${BEH}-${u.klic}', 'ZKPB ${BEH} ${u.klic}', 'tělo ${u.klic}', '${z.vis}', 'active', ${pribeh(z.pribeh)})`;
    });
    const pravidla = UZLY.filter((u) => u.zdroj?.tabulka === "expert_rules").map(
      (u) =>
        `('${ID_ZDROJE[u.klic]}', 'zkpb-${BEH}-${u.klic}', 'ZKPB ${BEH} ${u.klic}', 'tělo ${u.klic}', 'coding_standard', 'published', '${(u.zdroj as { vis: string }).vis}', '${I.autorPartner}', now())`,
    );
    const uzly = UZLY.map((u) => {
      const zdroj = u.zdroj ? `'${u.zdroj.tabulka}', '${ID_ZDROJE[u.klic]}'` : u.typ === "Memory" ? `'agent_memories', '${ID_ZDROJE[u.klic]}'` : "NULL, NULL";
      return `('${ID_UZLU[u.klic]}', '${u.typ}', 'zkpb-${BEH}-${u.klic}', 'ZKPB uzel ${BEH} ${u.klic}', ${zdroj}, ${pribeh(u.pribeh)})`;
    });
    psqlOk(`${I.sql}
INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${CIZI_PRIBEH}', 'ZKPB cizí příběh ${BEH}', '${U.sprava}');
UPDATE public.partner_stories SET repo_url = '${ZNACKA.repo}' WHERE id = '${I.pribeh}';
INSERT INTO public.story_contexts (story_id, mcp_endpoint, env_hints) VALUES ('${I.pribeh}', '${ZNACKA.mcp}', '{"zkpb": "${ZNACKA.env}"}'::jsonb)
  ON CONFLICT (story_id) DO UPDATE SET mcp_endpoint = EXCLUDED.mcp_endpoint, env_hints = EXCLUDED.env_hints;
INSERT INTO public.ai_runs (id, kind, story_id) VALUES ('${BEH_P}', 'chat', '${I.pribeh}'), ('${BEH_C}', 'chat', '${CIZI_PRIBEH}');
INSERT INTO public.ai_trace_events (run_id, event_type, operation, status) VALUES
  ('${BEH_P}', 'llm_call', '${ZNACKA.op}', 'ok'), ('${BEH_C}', 'llm_call', '${ZNACKA.opCizi}', 'ok');
INSERT INTO public.context_profiles (slug, display_name, layers, token_budget, priority_order, is_active)
  VALUES ('${PROFIL}', 'ZKPB ${BEH}', '{"memory": {"enabled": true, "max_events": 50}}'::jsonb, 100000, ARRAY['memory']::text[], true),
         ('${PROFIL_PROJEKT}', 'ZKPB projekt ${BEH}', '{"project_context": {"enabled": true}}'::jsonb, 100000, ARRAY['project_context']::text[], true);
INSERT INTO public.knowledge_items (id, item_type, source_type, source_slug, title, body_markdown, visibility, status, story_id)
  VALUES ${polozky.join(",\n         ")};
INSERT INTO public.expert_rules (id, slug, title, body_markdown, category, status, visibility, author_partner_id, published_at)
  VALUES ${pravidla.join(",\n         ")};
INSERT INTO public.graph_nodes (id, entity_type, entity_slug, entity_label, source_table, source_id, story_id)
  VALUES ${uzly.join(",\n         ")};
INSERT INTO public.products (id, name, slug, price, is_active) VALUES ('${PRODUKT}', 'ZKPB produkt ${BEH}', '${PRODUKT_SLUG}', 1, true);
INSERT INTO public.knowledge_topics (id, slug, title_key, visibility)
  VALUES ${TEMATA.map((t) => `('${ID_TEMATU[t.klic]}', '${slugTematu(t.klic)}', 'zkpb.${t.klic}', '${t.vis}')`).join(", ")};
INSERT INTO public.knowledge_topic_links (topic_id, product_id, link_type)
  VALUES ${TEMATA.map((t) => `('${ID_TEMATU[t.klic]}', '${PRODUKT}', 'product')`).join(", ")};`);
    for (const kdo of KDO) namereno[kdo] = zmer(CESTY, SONDY, kdo, U);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    const ids = (m: Record<string, string>) => Object.values(m).map((x) => `'${x}'`).join(", ");
    // Jedna transakce: selže-li cokoli, nic se nesmaže napůl (a test to ohlásí — psqlOk).
    psqlOk(`RESET ROLE;
BEGIN;
DELETE FROM public.knowledge_topic_links WHERE product_id = '${PRODUKT}';
DELETE FROM public.knowledge_topics WHERE id IN (${ids(ID_TEMATU)});
DELETE FROM public.products WHERE id = '${PRODUKT}';
DELETE FROM public.graph_nodes WHERE id IN (${ids(ID_UZLU)});
-- publikované pravidlo si spoušť zrcadlí do knowledge_items (source_id = id pravidla)
DELETE FROM public.knowledge_items WHERE id IN (${ids(ID_ZDROJE)}) OR source_id IN (${ids(ID_ZDROJE)});
DELETE FROM public.expert_rules WHERE id IN (${ids(ID_ZDROJE)});
DELETE FROM public.context_profiles WHERE slug IN ('${PROFIL}', '${PROFIL_PROJEKT}');
DELETE FROM public.ai_runs WHERE id IN ('${BEH_P}', '${BEH_C}');
DELETE FROM public.story_contexts WHERE story_id = '${I.pribeh}';
DELETE FROM public.partner_stories WHERE id = '${CIZI_PRIBEH}';
${I.uklid}
COMMIT;`);
  });

  if (MERENI) {
    it("režim měření: matice cesta × sonda × identita (bez tvrzení)", () => {
      const text = maticeText(CESTY, SONDY, namereno);
      console.log(text);
      expect(text.split("\n").length).toBeGreaterThan(3);
    });
    return;
  }

  it("kotva: správa dostane na každé cestě, co smí — cesty umějí sondu vrátit", () => {
    const n = namereno.sprava!;
    for (const c of CESTY) expect(SONDY.filter(c.sondy).some((s) => n[`${c.jmeno}|${s.klic}`] === "1"), `${c.jmeno}: správa nedostala nic`).toBe(true);
    expect(n).toEqual(ocekavaneMapa("sprava"));
  });

  it("kotva: vlastník a účastník dostanou metadata svého příběhu i paměť svého běhu", () => {
    for (const kdo of ["vlastnik", "ucastnik"] as const) {
      const n = namereno[kdo]!;
      for (const k of ["repo", "env", "mcp", "ucastnik"]) expect(n[`mcp_get_story_context (příběh sond)|${k}`], `${kdo}: ${k}`).toBe("1");
      expect(n["compose_context paměť běhu, přímo, bez příběhu|udalosti"], kdo).toBe("1");
      expect(n["tabulka graph_nodes pod RLS|cpribeh"], kdo).toBe("1");
    }
  });

  for (const kdo of KDO.filter((k) => k !== "sprava")) {
    it(`${kdo}: každá cesta vydá přesně to, co smí (ani víc, ani míň)`, () => {
      expect(namereno[kdo]).toEqual(ocekavaneMapa(kdo));
    });
  }

  it("nepřihlášený: témata produktu jen `public`; příběh, paměť běhu ani uzly grafu vůbec", () => {
    const n = namereno.anon!;
    expect(n["get_product_transparency (témata)|tpub"]).toBe("1");
    expect(n["get_product_transparency (témata)|tmem"]).toBe("0");
    const vydano = Object.entries(n)
      .filter(([k, v]) => v === "1" && !k.startsWith("get_product_transparency") && !k.includes("služba"))
      .map(([k]) => k);
    expect(vydano, "nepřihlášený dostal něco mimo veřejná témata").toEqual([]);
  });

  it("cesty, které anonym nemá, mu opravdu nejsou dostupné (právo EXECUTE / SELECT)", () => {
    const out = psqlOk(`SELECT 'mcp_get_story_context=' || has_function_privilege('anon', 'public.mcp_get_story_context(uuid)', 'EXECUTE');
SELECT 'compose_context=' || has_function_privilege('anon', 'public.compose_context(uuid,text,uuid,text,text,uuid)', 'EXECUTE');
SELECT 'graph_nodes=' || has_table_privilege('anon', 'public.graph_nodes', 'SELECT');`);
    expect(out.split("\n").filter((l) => !l.endsWith("=false"))).toEqual([]);
  });
});
