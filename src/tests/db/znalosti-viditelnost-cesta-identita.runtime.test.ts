/**
 * Viditelnost znalostí na VŠECH cestách čtení — cesta × identita × viditelnost, na skutečné databázi.
 *
 * Pravidlo majitele (HARD, 2026-10-04): nepřihlášený vidí jen `public`; `members` jen přihlášený.
 * Štítek znamená všude totéž: public = každý, members = přihlášený, guild = gilda (G1, 2026-10-05:
 * schválený konzultant studie s certifikací od správy), private = správa.
 *  · `archived` GLOBÁLNÍ položky nikdo kromě správy (čte ji jen tabulkou). Archivovaná položka
 *    PŘÍBĚHU zůstává vlastníkovi a účastníkovi (politika tabulky pro účastníky stav neřeší — svou
 *    položku mají vidět i po archivaci); funkce vydávají jen aktivní položky.
 *  · Položka příběhu podle pravidel příběhu (vlastník, účastník, správa). Ve VÝCHOZÍM příběhu instance
 *    (is_stack_default) navíc podle štítku tam, kde výchozí příběh otevírá cestu každému (citace a graf
 *    běhu, seznam položek příběhu) — soukromá položka výchozího příběhu tedy jen správě. Archivovaná a
 *    čekající (pending_review) položka výchozího příběhu jen s plným přístupem (správa; revize 2, N1:
 *    seznam je vydával přihlášenému bez role — archivovanou s p_include_archived, čekající i bez něj).
 *  · Zásada a rys jen globální, nebo v příběhu, ke kterému je přístup.
 *
 * Tvar převzatý ze zkoušky cest čtení větve feat/znalosti-platformy
 * (src/tests/db/znalosti-viditelnost-cesty-cteni.runtime.test.ts): mapa CESTY, relace podle identity,
 * kotva správy, cesta, kterou identita nemá, se ověří jako nedostupná. Rozšířeno o hranu gildy (vlastní
 * profil bez schválení, schválený bez certifikace, schválený a certifikovaný), `archived`, položky
 * příběhu a výchozího příběhu, vrstvu mozku, citace a graf běhu, službu, která čte ZA identitu,
 * PODVRŽENÉ publikum (přihlášený jmenuje správce — počítá se on sám) a přesnou rovnost.
 * Harness: src/tests/db/viditelnost-matice.ts.
 *
 * Běh: npm run test:db:znalosti-cteni (throwaway DB z baseline + heals).
 * Režim měření (tabulka před/po bez tvrzení): ZKV_MERENI=1.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPgReachable } from "./test-env-probe";
import {
  type Cesta,
  type Kdo,
  KDO,
  MERENI,
  S_PRISTUPEM,
  maticeText,
  psql,
  psqlOk,
  publikum,
  stitekPro,
  vytvorIdentity,
  zmer,
} from "./viditelnost-matice";

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

type Sonda = {
  klic: string;
  typ: "domain_doc" | "core_value" | "personality_trait";
  vis: string;
  status: "active" | "archived" | "pending_review";
  /** null = globální; "pribeh" = příběh sond; "vychozi" = výchozí příběh instance */
  pribeh: null | "pribeh" | "vychozi";
};
const S = (klic: string, typ: Sonda["typ"], vis: string, pribeh: Sonda["pribeh"] = null, status: Sonda["status"] = "active"): Sonda => ({ klic, typ, vis, status, pribeh });
const SONDY: Sonda[] = [
  S("gpub", "domain_doc", "public"),
  S("gmem", "domain_doc", "members"),
  S("ggil", "domain_doc", "guild"),
  S("gpri", "domain_doc", "private"),
  S("garc", "domain_doc", "public", null, "archived"),
  S("zpub", "core_value", "public"),
  S("zmem", "core_value", "members"),
  S("zgil", "core_value", "guild"),
  S("zpri", "core_value", "private"),
  S("rpub", "personality_trait", "public"),
  S("rmem", "personality_trait", "members"),
  S("rpri", "personality_trait", "private"),
  S("ppub", "domain_doc", "public", "pribeh"),
  S("ppri", "domain_doc", "private", "pribeh"),
  S("pzas", "core_value", "public", "pribeh"),
  S("parc", "domain_doc", "public", "pribeh", "archived"),
  S("dpub", "domain_doc", "public", "vychozi"),
  S("dpri", "domain_doc", "private", "vychozi"),
  S("darc", "domain_doc", "public", "vychozi", "archived"),
  S("dpen", "domain_doc", "members", "vychozi", "pending_review"),
];

const BEH = randomUUID().replace(/-/g, "").slice(0, 10);
const I = vytvorIdentity(BEH);
const U = I.U;
const BEH_ID = randomUUID();
const PROFIL = `zkvid-${BEH}`;
const ID: Record<string, string> = Object.fromEntries(SONDY.map((s) => [s.klic, randomUUID()]));
const USEK: Record<string, string> = Object.fromEntries(SONDY.map((s) => [s.klic, randomUUID()]));
const UZEL: Record<string, string> = Object.fromEntries(SONDY.map((s) => [s.klic, randomUUID()]));
const CIL: Record<string, string> = Object.fromEntries(SONDY.map((s) => [s.klic, randomUUID()]));
let VYCHOZI = "";
/** Jedinečné slovo sondy: hledání v2 i skládání kontextu najdou právě tuhle položku. */
const slovo = (s: Sonda) => `vs${BEH}${s.klic}`;
const slug = (s: Sonda) => `zkvid-${BEH}-${s.klic}`;
const stitekUzlu = (s: Sonda) => `ZKV uzel ${BEH} ${s.klic}`;
// Jednotkový vektor v jedné ose: podobnost sond s dotazem je 1, se vším ostatním v databázi nízká.
const VEKTOR = `('[' || array_to_string(array_fill(0::real, ARRAY[6]) || ARRAY[1::real] || array_fill(0::real, ARRAY[1017]), ',') || ']')::vector`;
const VEKTOR_V2 = `('[' || array_to_string(array_fill(0::real, ARRAY[6]) || ARRAY[1::real] || array_fill(0::real, ARRAY[2553]), ',') || ']')::halfvec`;
const pub = (kdo: Kdo) => publikum(kdo, U);

type CestaZ = Cesta<Sonda> & {
  /** Komu je cesta dostupná; ostatním „odepreno“ (42501). */
  pristup?: (kdo: Kdo) => boolean;
  /** Vydává položky příběhu sond (podle pravidel příběhu)? */
  pribehem?: boolean;
  /** Čte položku libovolného příběhu podle id (tabulka, čtení podle id) — správa vidí i cizí příběh. */
  libovolnyPribeh?: boolean;
  /** Ve výchozím příběhu instance vydává podle štítku (citace, graf, seznam výchozího příběhu). */
  vychoziPodleStitku?: boolean;
  /** Vydává globální položky (podle viditelnosti)? */
  globalni?: boolean;
  /** Archivovaná globální položka správě / archivovaná položka příběhu vlastníkovi a účastníkovi (jen tabulka). */
  archiv?: boolean;
  /** Které NEAKTIVNÍ položky výchozího příběhu vydá plnému přístupu (ve výchozím příběhu = správa). */
  neaktivniVychozi?: (s: Sonda) => boolean;
};

const VSE = () => true;
const JEN_PRIHLASENI = (kdo: Kdo) => kdo !== "anon";
const S_PRISTUPEM_F = (kdo: Kdo) => S_PRISTUPEM.includes(kdo);
const v2 = (s: Sonda, dalsi: string) =>
  `SELECT count(*) INTO n FROM jsonb_array_elements(public.mcp_search_knowledge_v2(p_query_text => '${slovo(s)}', p_limit => 50${dalsi})) r WHERE r->>'knowledge_item_id' = '${ID[s.klic]}'`;
const v3 = (s: Sonda, dalsi: string) =>
  `SELECT count(DISTINCT r.knowledge_item_id) INTO n FROM public.mcp_search_knowledge_v3(p_limit => 500, p_similarity_threshold => 0.9${dalsi}) r WHERE r.knowledge_item_id = '${ID[s.klic]}'`;
const slozeni = (pribeh: string, s: Sonda, zadatel: string, dotaz = true) =>
  `public.compose_context(${pribeh}, '${PROFIL}', NULL::uuid, ${dotaz ? `'${slovo(s)}'` : "NULL::text"}, NULL::text, ${zadatel})`;
const vKontextu = (s: Sonda, kontext: string) =>
  `SELECT LEAST(1, (SELECT count(*) FROM jsonb_array_elements(coalesce(c->'layers'->'kb_retrieval'->'chunks', '[]'::jsonb)) e WHERE e->>'knowledge_item_id' = '${ID[s.klic]}')
     + (SELECT count(*) FROM jsonb_array_elements(coalesce(c->'layers'->'governance_context'->'tao_principles', '[]'::jsonb)) e WHERE e->>'slug' = '${slug(s)}')
     + (SELECT count(*) FROM jsonb_array_elements(coalesce(c->'layers'->'psyche_context'->'psyche_traits', '[]'::jsonb)) e WHERE e->>'slug' = '${slug(s)}'))
   INTO n FROM (SELECT ${kontext} AS c) x`;
const vJson = (volani: string, pole: string, hodnota: string) =>
  `SELECT count(*) INTO n FROM jsonb_array_elements(${volani}) e WHERE e->>'${pole}' = '${hodnota}'`;
const podleId = (s: Sonda, dalsi = "") =>
  `SELECT CASE WHEN r->>'id' = '${ID[s.klic]}' THEN 1 ELSE 0 END INTO n FROM (SELECT public.mcp_get_knowledge_item(p_item_id => '${ID[s.klic]}'::uuid${dalsi}) AS r) x`;
const MOZEK = (s: Sonda) => s.typ !== "domain_doc";
const SPRAVCE = () => `'${U.sprava}'::uuid`;
const ZASADY = (s: Sonda) => s.typ === "core_value";
const RYSY = (s: Sonda) => s.typ === "personality_trait";

const CESTY: CestaZ[] = [
  { jmeno: "tabulka pod RLS", jako: "role", sondy: VSE, pribehem: true, libovolnyPribeh: true, archiv: true, neaktivniVychozi: VSE, sql: (s) => `SELECT count(*) INTO n FROM public.knowledge_items WHERE id = '${ID[s.klic]}'` },
  { jmeno: "v2 bez příběhu", jako: "role", sondy: VSE, sql: (s) => v2(s, ", p_story_id => NULL::uuid") },
  {
    jmeno: "v2 poziční (9 argumentů)",
    jako: "role",
    sondy: VSE,
    sql: (s) =>
      `SELECT count(*) INTO n FROM jsonb_array_elements(public.mcp_search_knowledge_v2(NULL::vector, '${slovo(s)}'::text, '{}'::text[], NULL::text, NULL::text, '{}'::text[], true, 50, 0.3::float8)) r WHERE r->>'knowledge_item_id' = '${ID[s.klic]}'`,
  },
  { jmeno: "v2 přímo, podvržené publikum = správa", jako: "role", sondy: VSE, sql: (s) => v2(s, `, p_story_id => NULL::uuid, p_audience_user_id => ${SPRAVCE()}`) },
  { jmeno: "v2 s příběhem", jako: "role", sondy: VSE, pristup: S_PRISTUPEM_F, pribehem: true, sql: (s) => v2(s, `, p_story_id => '${I.pribeh}'::uuid`) },
  { jmeno: "v2 služba za identitu, s příběhem", jako: "sluzba", sondy: VSE, pribehem: true, sql: (s, kdo) => v2(s, `, p_story_id => '${I.pribeh}'::uuid, p_audience_user_id => ${pub(kdo)}`) },
  { jmeno: "v3 (embedding v1)", jako: "role", sondy: VSE, pristup: JEN_PRIHLASENI, sql: (s) => v3(s, `, p_query_embedding_v1 => ${VEKTOR}`) },
  { jmeno: "v3 (embedding v2)", jako: "role", sondy: VSE, pristup: JEN_PRIHLASENI, sql: (s) => v3(s, `, p_query_embedding_v2 => ${VEKTOR_V2}, p_model_pref => 'v2'`) },
  { jmeno: "v3 přímo, podvržené publikum = správa", jako: "role", sondy: VSE, pristup: JEN_PRIHLASENI, sql: (s) => v3(s, `, p_query_embedding_v1 => ${VEKTOR}, p_audience_user_id => ${SPRAVCE()}`) },
  {
    jmeno: "v3 služba za identitu, s příběhem",
    jako: "sluzba",
    sondy: VSE,
    pribehem: true,
    sql: (s, kdo) => v3(s, `, p_query_embedding_v1 => ${VEKTOR}, p_story_id => '${I.pribeh}'::uuid, p_audience_user_id => ${pub(kdo)}`),
  },
  { jmeno: "mcp_get_knowledge_item", jako: "role", sondy: VSE, pribehem: true, libovolnyPribeh: true, sql: (s) => podleId(s) },
  { jmeno: "mcp_get_knowledge_item přímo, podvržené publikum = správa", jako: "role", sondy: VSE, pribehem: true, libovolnyPribeh: true, sql: (s) => podleId(s, `, p_audience_user_id => ${SPRAVCE()}`) },
  { jmeno: "mcp_get_knowledge_item služba za identitu", jako: "sluzba", sondy: VSE, pribehem: true, libovolnyPribeh: true, sql: (s, kdo) => podleId(s, `, p_audience_user_id => ${pub(kdo)}`) },
  { jmeno: "compose_context za žadatele, s příběhem", jako: "sluzba", sondy: VSE, pristup: S_PRISTUPEM_F, pribehem: true, sql: (s, kdo) => vKontextu(s, slozeni(`'${I.pribeh}'::uuid`, s, pub(kdo))) },
  { jmeno: "compose_context za žadatele, bez příběhu", jako: "sluzba", sondy: VSE, sql: (s, kdo) => vKontextu(s, slozeni("NULL::uuid", s, pub(kdo))) },
  {
    // Přihlášený volá napřímo a jako žadatele podstrčí správce: počítá se on sám, ne správce.
    jmeno: "compose_context přímo, podstrčený žadatel = správa",
    jako: "role",
    sondy: VSE,
    pristup: JEN_PRIHLASENI,
    sql: (s) => vKontextu(s, slozeni("NULL::uuid", s, SPRAVCE())),
  },
  {
    // Přihlášený bez přístupu volá napřímo skládání CIZÍHO příběhu a podstrčí správce: počítá se on sám → odepřeno.
    // Bez dotazu (p_query NULL) běží jen vrstvy mozku — ty publikum připínají samy, takže jedině tahle cesta
    // ukáže, jestli kontrolu příběhu dělá compose_context za skutečného volajícího.
    jmeno: "compose_context přímo, cizí příběh, podstrčený žadatel = správa",
    jako: "role",
    sondy: MOZEK,
    pristup: S_PRISTUPEM_F,
    sql: (s) => vKontextu(s, slozeni(`'${I.pribeh}'::uuid`, s, SPRAVCE(), false)),
  },
  { jmeno: "fn_get_tao_principles", jako: "role", sondy: ZASADY, pristup: JEN_PRIHLASENI, sql: (s) => vJson("public.fn_get_tao_principles()", "slug", slug(s)) },
  {
    jmeno: "fn_get_tao_principles přímo, podvržené publikum = správa",
    jako: "role",
    sondy: ZASADY,
    pristup: JEN_PRIHLASENI,
    sql: (s) => vJson(`public.fn_get_tao_principles(p_audience_user_id => ${SPRAVCE()})`, "slug", slug(s)),
  },
  {
    jmeno: "fn_get_tao_principles služba za identitu",
    jako: "sluzba",
    sondy: ZASADY,
    sql: (s, kdo) => vJson(`public.fn_get_tao_principles(p_audience_user_id => ${pub(kdo)})`, "slug", slug(s)),
  },
  { jmeno: "fn_get_psyche_traits", jako: "role", sondy: RYSY, pristup: JEN_PRIHLASENI, sql: (s) => vJson("public.fn_get_psyche_traits()", "slug", slug(s)) },
  {
    jmeno: "fn_get_psyche_traits přímo, podvržené publikum = správa",
    jako: "role",
    sondy: RYSY,
    pristup: JEN_PRIHLASENI,
    sql: (s) => vJson(`public.fn_get_psyche_traits(p_audience_user_id => ${SPRAVCE()})`, "slug", slug(s)),
  },
  {
    jmeno: "fn_get_psyche_traits služba za identitu",
    jako: "sluzba",
    sondy: RYSY,
    sql: (s, kdo) => vJson(`public.fn_get_psyche_traits(p_audience_user_id => ${pub(kdo)})`, "slug", slug(s)),
  },
  { jmeno: "fn_search_personality_context", jako: "role", sondy: RYSY, pristup: JEN_PRIHLASENI, sql: (s) => vJson("public.fn_search_personality_context()", "trait_id", ID[s.klic]) },
  {
    jmeno: "fn_get_run_citations (běh ve výchozím příběhu)",
    jako: "role",
    sondy: VSE,
    pristup: JEN_PRIHLASENI,
    pribehem: true,
    vychoziPodleStitku: true,
    sql: (s) => `SELECT count(DISTINCT c.item_id) INTO n FROM public.fn_get_run_citations('${BEH_ID}'::uuid) c WHERE c.item_id = '${ID[s.klic]}'`,
  },
  {
    jmeno: "fn_get_run_graph_context (výchozí uzly, běh ve výchozím příběhu)",
    jako: "role",
    sondy: (s) => s.pribeh !== "pribeh",
    pristup: JEN_PRIHLASENI,
    vychoziPodleStitku: true,
    sql: (s) => `SELECT LEAST(1, count(*)) INTO n FROM public.fn_get_run_graph_context('${BEH_ID}'::uuid, NULL, NULL) g WHERE g.seed_label = '${stitekUzlu(s)}'`,
  },
  {
    jmeno: "list_story_knowledge_items (příběh sond)",
    jako: "role",
    sondy: (s) => s.pribeh === "pribeh",
    pristup: S_PRISTUPEM_F,
    pribehem: true,
    globalni: false,
    sql: (s) => `SELECT count(*) INTO n FROM public.list_story_knowledge_items('${I.pribeh}'::uuid) l WHERE l.id = '${ID[s.klic]}'`,
  },
  {
    jmeno: "list_story_knowledge_items (výchozí příběh)",
    jako: "role",
    sondy: (s) => s.pribeh === "vychozi",
    pristup: JEN_PRIHLASENI,
    vychoziPodleStitku: true,
    globalni: false,
    // bez p_include_archived archivovanou nevydá nikomu; čekající jen plnému přístupu
    neaktivniVychozi: (s) => s.status === "pending_review",
    sql: (s) => `SELECT count(*) INTO n FROM public.list_story_knowledge_items('${VYCHOZI}'::uuid) l WHERE l.id = '${ID[s.klic]}'`,
  },
  {
    jmeno: "list_story_knowledge_items (výchozí příběh, s archivovanými)",
    jako: "role",
    sondy: (s) => s.pribeh === "vychozi",
    pristup: JEN_PRIHLASENI,
    vychoziPodleStitku: true,
    globalni: false,
    neaktivniVychozi: VSE,
    sql: (s) => `SELECT count(*) INTO n FROM public.list_story_knowledge_items('${VYCHOZI}'::uuid, p_include_archived => true) l WHERE l.id = '${ID[s.klic]}'`,
  },
];

/** Co má cesta pro identitu u sondy vrátit. */
function ocekavani(c: CestaZ, s: Sonda, kdo: Kdo): string {
  if (c.pristup && !c.pristup(kdo)) return "odepreno";
  if (s.pribeh === "pribeh") {
    if (s.status === "archived") return c.archiv && S_PRISTUPEM.includes(kdo) ? "1" : "0";
    return c.pribehem && S_PRISTUPEM.includes(kdo) ? "1" : "0";
  }
  if (s.pribeh === "vychozi") {
    // Neaktivní (archivovaná, čekající) položka výchozího příběhu: jen plný přístup a jen cesta, která ji vydává.
    if (s.status !== "active") return c.neaktivniVychozi?.(s) && kdo === "sprava" ? "1" : "0";
    if (c.vychoziPodleStitku) return String(stitekPro(s.vis, kdo));
    return c.libovolnyPribeh && kdo === "sprava" ? "1" : "0";
  }
  if (s.status === "archived") return c.archiv && kdo === "sprava" ? "1" : "0";
  return c.globalni === false ? "0" : String(stitekPro(s.vis, kdo));
}
const ocekavaneMapa = (kdo: Kdo) =>
  Object.fromEntries(CESTY.flatMap((c) => SONDY.filter(c.sondy).map((s) => [`${c.jmeno}|${s.klic}`, ocekavani(c, s, kdo)])));

// Přípravek i celá matice měření (identita × cesta × sonda) běží v beforeAll synchronně přes
// psql. Na sdíleném runneru CI pod zátěží přetekl výchozí strop háku 30 s (naměřeno
// 2026-10-06, PR #1160, job „DB: runtime testy“: „Hook timed out in 30000ms“, 12 testů
// přeskočeno). Strop výslovně pro oba háky — úklid pustí stejný počet dotazů.
const STROP_HAKU_MS = 180_000;
describe.skipIf(!isPgReachable() && !DB_SLIBENA)("viditelnost znalostí: cesta × identita × viditelnost", () => {
  const namereno: Partial<Record<Kdo, Record<string, string>>> = {};

  beforeAll(() => {
    if (!isPgReachable()) throw new Error("AISHA_DB_URL je nastavené (throwaway wrapper), ale DB není dosažitelná — vada harnessu, ne důvod přeskočit.");
    VYCHOZI = psqlOk("SELECT id FROM public.partner_stories WHERE is_stack_default = true ORDER BY created_at LIMIT 1");
    if (!VYCHOZI) throw new Error("databáze nemá výchozí příběh instance (ensure_stack_default_story) — přípravek citací, grafu a výchozího příběhu nemá kam");
    const pribehSondy = (s: Sonda) => (s.pribeh === "pribeh" ? `'${I.pribeh}'` : s.pribeh === "vychozi" ? `'${VYCHOZI}'` : "NULL");
    const polozky = SONDY.map(
      (s) =>
        `('${ID[s.klic]}', '${s.typ}', 'manual', '${slug(s)}', 'VS${BEH}${s.klic} sonda', 'sonda ${s.klic}', 'tělo sondy ${s.klic}', '${s.vis}', '${s.status}', ${pribehSondy(s)})`,
    );
    const citovane = SONDY.filter((s) => s.pribeh !== "pribeh");
    psqlOk(`${I.sql}
INSERT INTO public.context_profiles (slug, display_name, layers, token_budget, priority_order, is_active)
  VALUES ('${PROFIL}', 'ZKV ${BEH}', '{"kb_retrieval": {"enabled": true, "max_chunks": 50}}'::jsonb, 100000,
          ARRAY['governance_context', 'psyche_context', 'kb_retrieval']::text[], true);
INSERT INTO public.knowledge_items (id, item_type, source_type, source_slug, title, summary, body_markdown, visibility, status, story_id)
  VALUES ${polozky.join(",\n         ")};
INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
  VALUES ${SONDY.map((s) => `('${USEK[s.klic]}', '${ID[s.klic]}', 0, 'VS${BEH}${s.klic} úryvek')`).join(", ")};
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, embedding_v2)
  SELECT kc.id, kc.knowledge_item_id, ${VEKTOR}, ${VEKTOR_V2} FROM public.knowledge_chunks kc WHERE kc.id IN (${SONDY.map((s) => `'${USEK[s.klic]}'`).join(", ")});
INSERT INTO public.ai_runs (id, kind, story_id, citation_chunk_ids)
  VALUES ('${BEH_ID}', 'chat', '${VYCHOZI}', ARRAY[${citovane.map((s) => `'${USEK[s.klic]}'`).join(", ")}]::uuid[]);
INSERT INTO public.knowledge_attribution (story_id, knowledge_item_id, ai_run_id, relevance_score, attribution_weight)
  VALUES ${SONDY.map((s) => `('${VYCHOZI}', '${ID[s.klic]}', '${BEH_ID}', 0.5, 0.5)`).join(", ")};
INSERT INTO public.graph_nodes (id, entity_type, entity_slug, entity_label, source_table, source_id)
  VALUES ${citovane.map((s) => `('${UZEL[s.klic]}', 'KnowledgeItem', 'zkvid-${BEH}-${s.klic}', '${stitekUzlu(s)}', 'knowledge_items', '${ID[s.klic]}'), ('${CIL[s.klic]}', 'Concept', 'zkvid-cil-${BEH}-${s.klic}', 'ZKV cíl ${BEH} ${s.klic}', NULL, NULL)`).join(",\n         ")};
INSERT INTO public.graph_edges (source_node_id, target_node_id, relationship, confidence)
  VALUES ${citovane.map((s) => `('${UZEL[s.klic]}', '${CIL[s.klic]}', 'REFERENCES', 0.9)`).join(", ")};`);
    for (const kdo of KDO) namereno[kdo] = zmer(CESTY, SONDY, kdo, U);
  }, STROP_HAKU_MS);

  afterAll(() => {
    if (!isPgReachable()) return;
    const ids = (m: Record<string, string>) => Object.values(m).map((x) => `'${x}'`).join(", ");
    // Sondy core_value / personality_trait chrání spouště proti smazání (zásady a rysy jsou
    // v provozu neměnné). Zkušební řádky se smažou v JEDNÉ transakci se spouštěmi vypnutými jen
    // na ni: selže-li cokoli, ROLLBACK vrátí i vypnutí — spoušť nikdy nezůstane vypnutá. Dřív
    // úklid na spoušti spadl potichu (psql bez kontroly) a nechal v DB studii, konzultanty i sondy.
    psqlOk(`RESET ROLE;
BEGIN;
DELETE FROM public.graph_edges WHERE source_node_id IN (${ids(UZEL)});
DELETE FROM public.graph_nodes WHERE id IN (${ids(UZEL)}, ${ids(CIL)});
DELETE FROM public.knowledge_attribution WHERE ai_run_id = '${BEH_ID}';
DELETE FROM public.ai_runs WHERE id = '${BEH_ID}';
ALTER TABLE public.knowledge_items DISABLE TRIGGER trg_protect_core_values, DISABLE TRIGGER trg_protect_psyche_traits;
DELETE FROM public.knowledge_items WHERE id IN (${ids(ID)});
ALTER TABLE public.knowledge_items ENABLE TRIGGER trg_protect_core_values, ENABLE TRIGGER trg_protect_psyche_traits;
DELETE FROM public.context_profiles WHERE slug = '${PROFIL}';
${I.uklid}
COMMIT;`);
  }, STROP_HAKU_MS);

  if (MERENI) {
    it("režim měření: matice cesta × sonda × identita (bez tvrzení)", () => {
      const text = maticeText(CESTY, SONDY, namereno);
      console.log(text);
      expect(text.split("\n").length).toBeGreaterThan(3);
    });
    return;
  }

  it("kotva: správa dostane na každé cestě, co smí — i soukromou položku; cesty umějí sondu vrátit", () => {
    const n = namereno.sprava!;
    for (const c of CESTY) expect(SONDY.filter(c.sondy).some((s) => n[`${c.jmeno}|${s.klic}`] === "1"), `${c.jmeno}: správa nedostala nic`).toBe(true);
    expect(n).toEqual(ocekavaneMapa("sprava"));
  });

  it("kotva gildy: schválený a certifikovaný konzultant dostane `guild` na každé cestě, která globální položky vydává", () => {
    const n = namereno.gilda!;
    const ggil = SONDY.find((s) => s.klic === "ggil")!;
    const cesty = CESTY.filter((c) => c.sondy(ggil) && (!c.pristup || c.pristup("gilda")) && c.globalni !== false);
    expect(cesty.length).toBeGreaterThan(10);
    for (const c of cesty) expect(n[`${c.jmeno}|ggil`], `${c.jmeno}: gilda nedostala guild`).toBe("1");
  });

  for (const kdo of KDO.filter((k) => k !== "sprava")) {
    it(`${kdo}: každá cesta vydá přesně to, co smí (ani víc, ani míň)`, () => {
      expect(namereno[kdo]).toEqual(ocekavaneMapa(kdo));
    });
  }

  it("nepřihlášený: na žádné cestě nic jiného než aktivní globální `public` (souhrn pravidla majitele)", () => {
    const n = namereno.anon!;
    const sonda = (klic: string) => SONDY.find((s) => s.klic === klic)!;
    const neverejne = Object.entries(n)
      .filter(([, v]) => v === "1")
      .map(([k]) => sonda(k.split("|")[1]))
      .filter((s) => s.vis !== "public" || s.status !== "active" || s.pribeh !== null)
      .map((s) => s.klic);
    expect(neverejne, "nepřihlášený (i služba bez publika) vidí jen aktivní globální `public`").toEqual([]);
    expect(n["tabulka pod RLS|gpub"]).toBe("1");
    expect(n["v2 bez příběhu|gpub"]).toBe("1");
    expect(n["mcp_get_knowledge_item|gpub"]).toBe("1");
  });

  it("cesty, které anonym nemá, mu opravdu nejsou dostupné (právo EXECUTE)", () => {
    const f = [
      "public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid)",
      "public.compose_context(uuid,text,uuid,text,text,uuid)",
      "public.fn_get_tao_principles(uuid)",
      "public.fn_get_psyche_traits(uuid)",
      "public.fn_search_personality_context(uuid,vector,integer)",
      "public.fn_get_run_citations(uuid)",
      "public.fn_get_run_graph_context(uuid,integer,integer)",
      "public.list_story_knowledge_items(uuid,boolean)",
      "public.mcp_get_knowledge_stats()",
    ];
    const out = psqlOk(f.map((x) => `SELECT '${x}=' || has_function_privilege('anon', '${x}', 'EXECUTE');`).join("\n"));
    expect(out.split("\n").filter((l) => !l.endsWith("=false"))).toEqual([]);
    expect(psqlOk("SELECT has_function_privilege('authenticated', 'public.mcp_get_knowledge_stats()', 'EXECUTE')")).toBe("f");
  });
});
