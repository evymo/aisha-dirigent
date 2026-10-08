/**
 * Brána (TŘÍDNÍ): KAŽDÁ cesta, která čte znalosti nebo expertní pravidla, je zařazená — a drží vlastnost své třídy
 *
 * Pravidlo majitele (HARD, 2026-10-04): nepřihlášený vidí jen `public`; `members` jen přihlášený.
 * Štítek znamená všude totéž: public = každý, members = přihlášený, guild = gilda (G1, 2026-10-05:
 * schválený konzultant studie + certifikace od správy), private = správa. Domovem je
 * `public.knowledge_visibility_searchable(viditelnost, je_prihlasen, je_v_gilde)`; „je v gildě“ počítá jen
 * `public.knowledge_audience_in_guild(uživatel)`; čtenáři expertních pravidel se ptají přes
 * `public.expert_rule_visible_to(viditelnost, autor, publikum)`. Tvar domova a zákaz vlastních výčtů drží
 * brána znalosti-viditelnost-jeden-domov; TAHLE brána drží, že žádná cesta domov neobejde.
 *
 * SLEDOVANÉ TABULKY: knowledge_items, knowledge_chunks, knowledge_embeddings, expert_rules.
 * VESMÍR: každá funkce (podle CREATE FUNCTION, ne podle souboru — druhá funkce v souboru je zařazená
 * zvlášť), jejíž KÓD (bez komentářů a řetězců) sledovanou tabulku jmenuje — v jakékoli podobě:
 * `public.x`, `"x"`, čárkový join, v závorkách. Funkce, která skládá dynamické SQL (EXECUTE) a sledovanou
 * tabulku jmenuje v kódu nebo v řetězci, je NÁLEZ: tu brána nepřečte.
 *
 * Třídy (vlastnost se měří na úrovni PŘÍKAZŮ těla, rozdělených na `;`):
 *   DOMOV      každý příkaz, který tabulku čte, volá její pomocník viditelnosti: knowledge_* domov se třemi
 *              vstupy (a knowledge_items i pomocník čitelného stavu), expert_rules expert_rule_visible_to.
 *              Identita předaná pomocníkovi je připnutá (auth.uid(), služba smí jmenovat publikum, nic
 *              jiného), gilda jen z knowledge_audience_in_guild, správa jen z is_admin_or_staff, žádná
 *              obchvatná větev (`= 'anon'`, `OR true`). Zásady a rysy bez výjimky podle typu.
 *   SKLADATEL  compose_context: obsah znalostí jen ze čtenářů DOMOV se žadatelem, z tabulek znalostí jen
 *              vektor dotazu; pravidla rulesetu přes expert_rule_visible_to se žadatelem; žadatel připnutý.
 *   PRIBEH     jen položky JEDNOHO příběhu se stráží přístupu.
 *   AUTOR      jen pravidla, jejichž autorem je volající.
 *   SPRAVA     pohled správy — přihlášenému jen se stráží správy, anonymovi nikdy.
 *   SLUZBA     interní dráha vydaná JEN servisní roli.
 *   ZAPIS      píše do sledované tabulky a obsah nevrací (void / boolean / uuid / integer / trigger;
 *              jsonb jen se stráží správy nebo jen službě).
 *   ODVOZENI   čte jen identifikátory, verze nebo otisk (obsahové sloupce jen uvnitř md5/digest) a řádky
 *              obsahu nevrací.
 * Funkce bez SECURITY DEFINER čte právy volajícího (dědí politiky tabulek) — zařazovat ji netřeba.
 * Politiky SELECT nad knowledge_items a expert_rules pro role API jsou zařazené stejně.
 * Chování tříd měří matice nad skutečnou databází: src/tests/db/znalosti-viditelnost-cesta-identita a
 * src/tests/db/pravidla-viditelnost-cesta-identita (cesta × identita × sonda).
 *
 * ZNÁMÉ MEZE (pojmenované, ne tiché):
 *  · třída SLUZBA hlídá, kdo funkci SMÍ spustit — ne, co s obsahem udělá další článek. Druhý index
 *    (fn_build_ragnarok_document → Ragnarok) viditelnost nezná a jeho čtenář přístup k projektu
 *    neověřuje (nález rady K1) — samostatná práce „druhý index“;
 *  · graf znalostí (graph_nodes / graph_edges) brána nesleduje: uzel KnowledgeItem nese entity_label =
 *    titulek položky. Čtení grafu NAPŘÍMO (politika graph_nodes) od 2026-10-06 vydá uzel jen tomu, kdo
 *    smí číst jeho zdroj (politiky knowledge_items / expert_rules) — drží brána rbac-4clause-unification.
 *    Definer čtenáři grafu ale dál ne: CÍLOVÉ uzly fn_graph_multihop (graf běhu, vrstva graph_context)
 *    jdou ven bez ohledu na viditelnost zdroje (výchozí uzly fn_get_run_graph_context se domova ptají) —
 *    samostatná práce „izolace grafu“ (nález revize 0356c9b91).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripSqlComments } from "../../../scripts/db/lib/sql-comments.mjs";

const ROOT = process.cwd();
const FUNKCE = join(ROOT, "aisha/db/sql/functions");
const POLITIKY = join(ROOT, "aisha/db/sql/policies");
const MCP = join(ROOT, "services/svc-mcp-knowledge/src/routes/mcp.ts");

type Trida = "DOMOV" | "SKLADATEL" | "PRIBEH" | "AUTOR" | "SPRAVA" | "SLUZBA" | "ZAPIS" | "ODVOZENI";

const TRIDY: Record<Trida, readonly string[]> = {
  DOMOV: [
    // znalosti
    "fn_get_psyche_traits",
    "fn_get_run_citations",
    "fn_get_run_graph_context",
    "fn_get_tao_principles",
    "fn_search_personality_context",
    "mcp_get_knowledge_item",
    "mcp_search_knowledge_v2",
    "mcp_search_knowledge_v3",
    // expertní pravidla
    "assess_code_quality",
    "create_story_ruleset", // do rulesetu jen viditelné pravidlo (jinak 42501)
    "evaluate_test_strategy",
    "generate_copilot_instructions",
    "generate_default_copilot_instructions", // veřejný artefakt: publikum NULL = jen `public`
    "get_expert_rule_detail",
    "get_expert_rules",
    "get_expertise_areas", // počty
    "get_guild_member_detail", // veřejný profil: publikum NULL
    "get_guild_members", // počty
    "get_instruction_payload",
    "get_my_rule_subscriptions",
    "get_story_knowledge_context",
    "get_story_rulesets",
    "list_agent_kb_bindings",
    "mcp_consult_dirigent", // veřejný výběr: publikum NULL
    "mcp_get_agent_knowledge",
    "mcp_get_compliance_context",
    "mcp_get_expertise_areas", // počty
    "mcp_get_rule_detail",
    "mcp_get_story_context",
    "mcp_match_experts", // počty
    "mcp_propose_improvement",
    "mcp_request_unblock",
    "mcp_search_knowledge",
    "moderate_development_flow",
    "recommend_ruleset_for_story",
    "subscribe_to_expert_rule",
  ],
  SKLADATEL: ["compose_context"],
  PRIBEH: [
    "export_story_bundle", // balík příběhu (správa nebo token instance)
    "list_story_knowledge_items", // vlastník, účastník, správa; výchozí příběh podle štítku
  ],
  AUTOR: ["get_my_contributed_rules", "publish_expert_rule", "update_expert_rule_audited"],
  SPRAVA: [
    "extract_training_pairs_from_kb",
    "fn_get_platform_warmup_state",
    "fn_list_quarantined_items",
    "get_moderation_queue",
    "li_dedupe_knowledge_items",
    "mcp_get_knowledge_stats", // jen službě; nástroj MCP get_knowledge_stats je v ADMIN_TOOLS (kotva níž)
  ],
  SLUZBA: [
    "audience_note_vectorize",
    "clear_knowledge_item_chunks",
    "fn_aisha_kb_decision",
    "fn_build_ragnarok_document", // druhý index — viz ZNÁMÁ MEZ v hlavičce
    "fn_chunks_bez_zive_identity",
    "fn_enrich_chunk_context_audited",
    "fn_get_chunks_needing_context",
    "fn_get_embeddings_needing_v2",
    "fn_get_run_extract_context",
    "fn_record_safety_scan_audited",
    "get_knowledge_items_for_embedding",
    "get_rules_for_embedding",
    "insert_knowledge_chunk",
    "insert_knowledge_embedding",
    "insert_knowledge_embedding_v2_audited",
    "materialize_agent_runtime",
    "update_rule_embedding",
  ],
  ZAPIS: [
    "approve_story_promotion",
    "create_expert_rule_audited",
    "delete_story_knowledge_item_audited",
    "fn_reinstate_knowledge_item_audited",
    "import_story_bundle",
    "merge_stories_audited",
    "rate_expert_rule",
    "review_moderation_item",
    "sync_expert_rule_to_knowledge_item",
    "sync_topic_version_to_knowledge_item",
    "unsubscribe_from_expert_rule",
    "upsert_story_knowledge_item_audited",
  ],
  ODVOZENI: [
    "create_story_from_preset",
    "fn_recalculate_ruleset_fingerprint",
    "install_agent_as_story",
    "recalculate_all_ruleset_fingerprints",
    "set_agent_knowledge_binding_audited",
  ],
};

/** Politiky SELECT pro role API: jméno → třída (GLOBALNI = ptá se množiny štítků domova). */
const POLITIKY_TRIDY: Record<string, "GLOBALNI" | "PRIBEH" | "SPRAVA"> = {
  "knowledge_items.knowledge_items_global_anon_read": "GLOBALNI",
  "knowledge_items.knowledge_items_global_authenticated_read": "GLOBALNI",
  "knowledge_items.knowledge_items_story_participants_read": "PRIBEH",
  "knowledge_items.knowledge_items_admin_read": "SPRAVA",
  "expert_rules.anon_read_public_rules": "GLOBALNI",
  "expert_rules.auth_read_public_and_members_rules": "GLOBALNI",
};

/** Čtenáři, které SKLADATEL smí volat (každý z třídy DOMOV) — a každému musí předat žadatele. */
const SKLADATEL_VOLA = ["mcp_search_knowledge_v2", "fn_get_tao_principles", "fn_get_psyche_traits"];

const ZNALOSTI = ["knowledge_items", "knowledge_chunks", "knowledge_embeddings"];
const PRAVIDLA = ["expert_rules"];
const SLEDOVANE = [...ZNALOSTI, ...PRAVIDLA];
/** Jméno sledované tabulky v kódu v jakékoli podobě (public.x, "x", public."x"); ne jako část jiného jména. */
const jmenoRe = (tabulky: readonly string[]) => new RegExp(`(?<![\\w."])(?:public\\s*\\.\\s*)?"?(?:${tabulky.join("|")})"?(?![\\w"])`, "i");
const SLED_RE = jmenoRe(SLEDOVANE);
const ZNAL_RE = jmenoRe(ZNALOSTI);
const ITEMS_RE = jmenoRe(["knowledge_items"]);
const PRAV_RE = jmenoRe(PRAVIDLA);
/** Příkaz, ve kterém je tabulka JEN cílem zápisu (UPDATE x / INSERT INTO x / DELETE FROM x), ji nečte. */
const jenZapis = (prikaz: string, re: RegExp) => {
  const zbytek = prikaz.replace(new RegExp(`\\b(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+(?:ONLY\\s+)?${re.source}`, "gi"), " ");
  return !re.test(zbytek);
};
/** Kolikrát příkaz tabulku ČTE (zmínky bez cílů zápisu). */
const cteni = (prikaz: string, re: RegExp) =>
  (prikaz.replace(new RegExp(`\\b(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+(?:ONLY\\s+)?${re.source}`, "gi"), " ").match(new RegExp(re.source, "gi")) ?? []).length;
const PISE = new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:ONLY\\s+)?${SLED_RE.source}`, "i");
/** Příkaz EXECUTE jazyka PL/pgSQL (ne `GRANT EXECUTE ON …` ani `EXECUTE FUNCTION` spouště). */
const DYNAMICKE = /\bEXECUTE\s+(?!ON\b|FUNCTION\b|PROCEDURE\b)/i;
/** Stráž správy: is_admin_or_staff(…) nebo has_role(auth.uid(), 'admin' | 'staff') — měří se na těle S řetězci (role je literál). */
const STRAZ_SPRAVY = /is_admin_or_staff\s*\(|has_role\s*\(\s*auth\.uid\(\)\s*,\s*'(?:admin|staff)'\s*\)/i;
const DEFINER = /SECURITY\s+DEFINER/i;
/**
 * Obchvatné větve: výjimka podle role (`= 'anon'`) a KONSTANTNÍ operand logické spojky místo podmínky
 * (`OR true`, `AND true)`, `(true AND …`, `WHEN true THEN`) — tvar, který zbude, když se volání domova
 * nahradí konstantou. `x = true OR …` ani `p IS TRUE OR …` konstantou nejsou (před `true` stojí porovnání).
 */
const OBCHVAT = [
  /=\s*'anon'/i,
  /\bOR\s+\(?\s*true\b(?!\s*(?:=|<>|!=|\bIS\b))/i,
  /(?<![=<>!]\s*|\bIS\s+|\bIS\s+NOT\s+|\bDISTINCT\s+FROM\s+)\btrue\s*\)?\s+OR\b/i,
  /\bWHEN\s+true\s+THEN\b/i,
  /\bAND\s+\(?\s*true\s*\)?\s*(?:\)|\bAND\b|\bOR\b|;|$)/i,
  /(?:\(|\bAND|\bWHERE|\bON)\s+\(?\s*true\s*\)?\s+AND\b/i,
];
/** Obsahové sloupce sledovaných tabulek (s aliasem). */
const OBSAH = /\b[a-z_][a-z0-9_]*\.(?:title|summary|body_markdown|ai_instructions|chunk_text|content|body)\b/gi;

/** Řetězce a značky $…$ pryč: jméno tabulky v řetězci (typ entity, název zdroje) není čtení. */
const bezRetezcu = (kod: string) => kod.replace(/E?'(?:[^']|'')*'/g, " '' ");

export type Funkce = { jmeno: string; hlavicka: string; telo: string; holeTelo: string; komu: string[]; vraci: string; definer: boolean; retezce: string[] };

/** Rozdělí soubory SQL na funkce (podle CREATE FUNCTION). Čistá funkce — brána i kotva měří touž. */
export function rozdelNaFunkce(soubory: Record<string, string>): Funkce[] {
  const out: Funkce[] = [];
  for (const kod of Object.values(soubory)) {
    for (const m of kod.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) {
      const zbytek = kod.slice(m.index);
      const tag = /\bAS\s+\$([a-z_]*)\$/i.exec(zbytek);
      if (!tag) continue;
      const zac = tag.index + tag[0].length;
      const konec = zbytek.indexOf(`$${tag[1]}$`, zac);
      if (konec < 0) continue;
      const telo = zbytek.slice(zac, konec);
      const hlavicka = zbytek.slice(0, tag.index);
      const jmeno = m[1].toLowerCase();
      const komu = [
        ...new Set(
          [...kod.matchAll(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:public\\s*\\.\\s*)?${jmeno}\\s*\\([^)]*\\)\\s*TO\\s+([^;]+);`, "gi"))].flatMap((g) =>
            g[1].split(",").map((r) => r.trim().toLowerCase()),
          ),
        ),
      ];
      out.push({
        jmeno,
        hlavicka,
        telo,
        holeTelo: bezRetezcu(telo),
        komu,
        vraci: (/\bRETURNS\s+(TABLE\b|SETOF\b|[A-Za-z_."]+)/i.exec(hlavicka)?.[1] ?? "?").toLowerCase(),
        definer: DEFINER.test(hlavicka) || DEFINER.test(zbytek.slice(konec + tag[1].length + 2, zbytek.indexOf(";", konec + tag[1].length + 2))),
        retezce: [...telo.matchAll(/E?'((?:[^']|'')*)'/g)].map((r) => r[1]),
      });
    }
  }
  return out;
}

/** Příkazy těla rozdělené na `;` v nejvyšší úrovni (mimo řetězce a závorky). Pracuje nad tělem BEZ řetězců. */
export function prikazy(holeTelo: string): string[] {
  const out: string[] = [];
  let cur = "";
  let hloubka = 0;
  for (const c of holeTelo) {
    cur += c;
    if (c === "(") hloubka++;
    else if (c === ")") hloubka--;
    else if (c === ";" && hloubka <= 0) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const sahaNaSledovane = (f: Funkce) => SLED_RE.test(f.holeTelo);
/** Dynamické SQL nad sledovanou tabulkou (v kódu nebo v řetězci) — brána ho nepřečte. */
const dynamickeNadSledovanou = (f: Funkce) => DYNAMICKE.test(f.holeTelo) && (sahaNaSledovane(f) || f.retezce.some((r) => SLED_RE.test(r)));

/** Argumenty volání (párování závorek ručně). */
function volani(kod: string, fce: string): string[][] {
  const out: string[][] = [];
  for (const m of kod.matchAll(new RegExp(`public\\.${fce}\\s*\\(`, "gi"))) {
    let i = (m.index ?? 0) + m[0].length;
    let hl = 1;
    const zac = i;
    while (i < kod.length && hl > 0) {
      if (kod[i] === "(") hl++;
      else if (kod[i] === ")") hl--;
      i++;
    }
    const a = kod.slice(zac, i - 1);
    const args: string[] = [];
    let cur = "";
    let h = 0;
    for (const c of a) {
      if (c === "(") h++;
      if (c === ")") h--;
      if (c === "," && h === 0) {
        args.push(cur.trim());
        cur = "";
      } else cur += c;
    }
    args.push(cur.trim());
    out.push(args);
  }
  return out;
}

/** Přiřazení proměnné v těle (`v := …;` i výchozí hodnota v DECLARE). */
const prirazeni = (holeTelo: string, v: string) =>
  [...holeTelo.matchAll(new RegExp(`\\b${v}\\b\\s+(?:[a-z_]+\\s+)?(?:boolean|uuid)?\\s*:=\\s*([^;]+);|\\b${v}\\s*:=\\s*([^;]+);`, "gi"))].map((m) => (m[1] ?? m[2]).replace(/\s+/g, " ").trim());

/** Připnutá identita: výraz smí být auth.uid(), NULL (bez identity), nebo proměnná přiřazená jen připnutým tvarem. */
function vadaIdentity(f: Funkce, vyraz: string): string | null {
  const v = vyraz.replace(/\s+/g, " ").trim();
  if (/^\(?\s*(?:SELECT\s+)?auth\.uid\(\)\s*\)?$/i.test(v) || /^NULL(?:::uuid)?$/i.test(v) || /^false$/i.test(v)) return null;
  if (!/^[a-z_][a-z0-9_]*$/i.test(v)) return `identita „${v}“ není proměnná ani auth.uid() / NULL`;
  if (/^p_/i.test(v)) return `identita ${v} je parametr — volající by si jmenoval, pro koho se čte; připni ji (služba CASE WHEN get_jwt_role() = 'service_role' …, jinak auth.uid())`;
  const pr = prirazeni(f.holeTelo, v);
  if (pr.length === 0) return `identita ${v} se nikde nepřiřazuje`;
  if (new RegExp(`\\bINTO\\s+(?:[a-z_0-9,\\s]*,\\s*)?${v}\\b`, "i").test(f.holeTelo)) return `identita ${v} se plní přes SELECT … INTO (nepřipnuto)`;
  const SLUZBA_JMENUJE = /^CASE WHEN (?:public\.get_jwt_role\(\)|v_caller_role) = '' THEN COALESCE\(p_[a-z_]+, auth\.uid\(\)\) ELSE auth\.uid\(\) END$/i;
  if (pr.some((rhs) => /v_caller_role/.test(rhs))) {
    const role = prirazeni(f.holeTelo, "v_caller_role");
    if (role.length === 0 || role.some((x) => !/^public\.get_jwt_role\(\)$/i.test(x))) return "v_caller_role se smí plnit jen z public.get_jwt_role()";
  }
  // Hledání rysů pro hippocampus: služba / správa jmenuje p_user_id (IDOR stráž výš), jinak volající sám.
  const OSOBNOST = /^CASE WHEN public\.is_service_role\(\) THEN p_user_id ELSE COALESCE\(v_effective_user_id, auth\.uid\(\)\) END$/i;
  for (const rhs of pr) {
    if (/^auth\.uid\(\)$/i.test(rhs) || SLUZBA_JMENUJE.test(rhs) || OSOBNOST.test(rhs)) continue;
    return `identita ${v} := ${rhs} — publikum smí jmenovat jen služba (CASE WHEN get_jwt_role() = 'service_role' …), jinak auth.uid()`;
  }
  return null;
}

/** Proč DOMOV funkce nedrží vlastnost (null = drží). */
function vadaDomov(f: Funkce): string | null {
  for (const re of OBCHVAT) if (re.test(f.telo)) return `obchvatná větev ${re} — viditelnost nesmí mít výjimku podle role ani konstantu`;
  if (/\bOR\s*\(?[^;()]*\bitem_type\b(?:::text)?\s+IN\s*\(\s*'(?:core_value|personality_trait)'/i.test(f.telo)) return "výjimka podle typu položky vedle viditelnosti";
  let cte = 0;
  for (const p of prikazy(f.holeTelo)) {
    const znal = ZNAL_RE.test(p) && !jenZapis(p, ZNAL_RE);
    const prav = PRAV_RE.test(p) && !jenZapis(p, PRAV_RE);
    if (!znal && !prav) continue;
    cte++;
    if (znal) {
      const domovy = volani(p, "knowledge_visibility_searchable");
      if (domovy.length === 0) return `příkaz čte znalosti a nevolá domov viditelnosti: ${p.trim().slice(0, 120)}…`;
      if (cteni(p, ITEMS_RE) > domovy.length) return `příkaz čte knowledge_items ${cteni(p, ITEMS_RE)}× a domov volá ${domovy.length}× — každé čtení má svůj filtr`;
      for (const a of domovy) {
        if (a.length !== 3) return "domov se volá jinak než se třemi vstupy";
        const prihlasen = /^(.*?)\s+IS\s+NOT\s+NULL$/i.exec(a[1])?.[1] ?? (/^false$/i.test(a[1]) ? "false" : null);
        if (prihlasen === null) return `„je přihlášen“ = ${a[1]} — musí být <identita> IS NOT NULL (u anonyma false)`;
        const vi = vadaIdentity(f, prihlasen);
        if (vi) return vi;
        if (!/^false$/i.test(a[2])) {
          const gilda = /^public\.knowledge_audience_in_guild\((.+)\)$/i.exec(a[2]);
          if (gilda) {
            const vg = vadaIdentity(f, gilda[1]);
            if (vg) return vg;
          } else if (/^[a-z_][a-z0-9_]*$/i.test(a[2])) {
            const pr = prirazeni(f.holeTelo, a[2]);
            if (pr.length === 0 || pr.some((r) => !/^public\.knowledge_audience_in_guild\(.+\)$/i.test(r))) return `gilda ${a[2]} se smí počítat jen z public.knowledge_audience_in_guild`;
          } else return `gilda = ${a[2]} — jen public.knowledge_audience_in_guild(…)`;
        }
      }
      if (ITEMS_RE.test(p) && !jenZapis(p, ITEMS_RE) && !/public\.knowledge_state_readable\s*\(/i.test(p)) return "příkaz čte knowledge_items a nevolá pomocníka čitelného stavu";
    }
    if (prav) {
      const pom = volani(p, "expert_rule_visible_to");
      if (pom.length === 0) return `příkaz čte expert_rules a nevolá public.expert_rule_visible_to: ${p.trim().slice(0, 120)}…`;
      if (cteni(p, PRAV_RE) > pom.length) return `příkaz čte expert_rules ${cteni(p, PRAV_RE)}× a pomocník volá ${pom.length}× — každé čtení má svůj filtr`;
      for (const a of pom) {
        if (a.length !== 3) return "expert_rule_visible_to se volá jinak než se třemi vstupy";
        const vi = vadaIdentity(f, a[2]);
        if (vi) return vi;
      }
    }
    // Větev správy jen ze stráže správy.
    if (/\bv_is_admin\b/.test(p)) {
      const pr = prirazeni(f.holeTelo, "v_is_admin");
      if (pr.length === 0 || pr.some((r) => !/is_admin_or_staff\s*\(/i.test(r) && !/^false$/i.test(r))) return "v_is_admin se smí počítat jen z is_admin_or_staff(…)";
      if (!pr.some((r) => /is_admin_or_staff\s*\(/i.test(r))) return "v_is_admin se nikde nepočítá ze stráže správy";
    }
  }
  if (cte === 0) return "nečte žádnou sledovanou tabulku — do DOMOV nepatří";
  return null;
}

/** Proč funkce NEDRŽÍ vlastnost své třídy (null = drží). */
function vadaTridy(trida: Trida, f: Funkce): string | null {
  const holy = f.holeTelo;
  const komu = f.komu;
  const jenSluzbe = komu.length > 0 && komu.every((k) => k === "service_role");
  const strazSpravy = STRAZ_SPRAVY.test(f.telo) && /RAISE\s+EXCEPTION/i.test(holy);
  switch (trida) {
    case "DOMOV":
      return vadaDomov(f);
    case "SKLADATEL": {
      for (const fce of SKLADATEL_VOLA) {
        const v = volani(holy, fce);
        if (v.length === 0) return `nevolá ${fce} — nový zdroj kontextu zařaď (a měř) zvlášť`;
        if (v.some((a) => !a.some((x) => /^p_audience_user_id\s*:=\s*v_requester$/i.test(x)))) return `volá ${fce} bez žadatele (p_audience_user_id := v_requester)`;
      }
      for (const p of prikazy(holy)) {
        const vektor = /\bSELECT\s+ke\.embedding\s+INTO\s+v_query_embedding\s+FROM\s+knowledge_embeddings\s+ke\s+JOIN\s+knowledge_chunks\s+kc\b/i.test(p) && (p.match(/\bSELECT\b/gi) ?? []).length === 1;
        if (ZNAL_RE.test(p) && !jenZapis(p, ZNAL_RE) && !vektor) {
          return `čte tabulky znalostí mimo náhradní vektor dotazu: ${p.trim().slice(0, 100)}…`;
        }
        if (PRAV_RE.test(p) && !jenZapis(p, PRAV_RE)) {
          const pom = volani(p, "expert_rule_visible_to");
          if (pom.length === 0 || pom.some((a) => a[2] !== "v_requester")) return "pravidla rulesetu bez public.expert_rule_visible_to(…, v_requester)";
        }
      }
      return vadaIdentity(f, "v_requester");
    }
    case "PRIBEH":
      if (!/\bki\.story_id\s*=\s*p_story_id\b/i.test(holy)) return "nečte jen položky jednoho příběhu (ki.story_id = p_story_id)";
      if (/\bki\.story_id\s+IS\s+NULL\b/i.test(holy)) return "čte i globální položky — ty patří čtenáři třídy DOMOV";
      if (!STRAZ_SPRAVY.test(f.telo) || !/RAISE\s+EXCEPTION/i.test(holy)) return "neověřuje přístup k příběhu (stráž správy / vlastníka / účastníka s RAISE)";
      if (komu.includes("anon") || komu.includes("public")) return "je vydaná anonymovi";
      return null;
    case "AUTOR":
      for (const p of prikazy(holy)) {
        if (!(PRAV_RE.test(p) && !jenZapis(p, PRAV_RE))) continue;
        const autor = /author_partner_id/i.test(p) && (/\bpp\.user_id\s*=\s*(?:auth\.uid\(\)|v_caller_id)\b/i.test(p) || /author_partner_id\s*=\s*v_partner_id\b/i.test(p));
        if (!autor) return `příkaz čte pravidla bez omezení na autora = volající: ${p.trim().slice(0, 100)}…`;
      }
      for (const v of ["v_caller_id", "v_partner_id"]) {
        for (const r of prirazeni(holy, v)) if (!/auth\.uid\(\)/i.test(r)) return `${v} := ${r} — autor musí být volající (auth.uid())`;
      }
      if (/\bv_partner_id\b/.test(holy) && !/SELECT\s+pp\.id\s+INTO\s+v_partner_id\s+FROM\s+partner_profiles\s+pp\s+WHERE\s+pp\.user_id\s*=\s*auth\.uid\(\)/i.test(holy) && prirazeni(holy, "v_partner_id").length === 0) {
        return "v_partner_id se neplní z profilu volajícího";
      }
      return null;
    case "SPRAVA":
      if (komu.includes("anon") || komu.includes("public")) return "pohled správy je vydaný anonymovi";
      if (komu.includes("authenticated") && !strazSpravy) return "pohled správy je vydaný přihlášenému bez stráže správy (is_admin_or_staff + RAISE)";
      if (/public\.knowledge_visibility_searchable\s*\(/i.test(holy)) return "volá domov viditelnosti — pohled správy vidí vše; je-li to čtenář, patří do DOMOV";
      return null;
    case "SLUZBA":
      if (!jenSluzbe) return `interní dráha služby je vydaná i jiným rolím (${komu.join(", ") || "nikomu"}) — buď jen service_role, nebo ji zařaď jako čtenáře`;
      return null;
    case "ZAPIS": {
      if (!PISE.test(holy)) return "do sledovaných tabulek nepíše — do třídy ZAPIS nepatří";
      if (f.vraci === "table" || f.vraci === "setof") return "zapisovatel vrací řádky";
      if (["void", "boolean", "uuid", "trigger", "integer", "bigint"].includes(f.vraci)) return null;
      if (jenSluzbe || (strazSpravy && !komu.includes("anon"))) return null;
      return `vrací ${f.vraci} rolím API bez stráže správy`;
    }
    case "ODVOZENI": {
      if (f.vraci === "table" || f.vraci === "setof") return "odvození vrací řádky";
      if (komu.includes("anon") || komu.includes("public")) return "je vydaná anonymovi";
      const bezHashu = holy.replace(/\b(?:md5|digest)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi, " ");
      const aliasy = [...holy.matchAll(new RegExp(`(?:FROM|JOIN|,)\\s+${SLED_RE.source}\\s+(?:AS\\s+)?([a-z_][a-z0-9_]*)`, "gi"))]
        .map((m) => m[1].toLowerCase())
        .filter((a) => !["where", "on", "join", "left", "inner", "set", "order", "group", "limit", "using"].includes(a));
      const obsah = [...bezHashu.matchAll(OBSAH)].map((m) => m[0]).filter((c) => aliasy.includes(c.split(".")[0].toLowerCase()));
      if (/\bSELECT\s+(?:[a-z_]+\s*,\s*)*(?:title|summary|body_markdown|ai_instructions|chunk_text)\b[^;]*\bFROM\s+(?:public\.)?"?(?:knowledge_items|expert_rules|knowledge_chunks)"?\s*(?:WHERE|;)/i.test(bezHashu)) obsah.push("(bez aliasu)");
      if (obsah.length) return `čte obsahové sloupce mimo otisk (${[...new Set(obsah)].join(", ")}) — čtenář obsahu patří do DOMOV`;
      return null;
    }
  }
}

/** Odchylky celého zařazení. Čistá funkce — brána i kotva měří touž. */
export function vadyZarazeni(funkce: Funkce[], tridy: Record<Trida, readonly string[]>): string[] {
  const vady: string[] = [];
  const kde = new Map<string, Trida[]>();
  for (const t of Object.keys(tridy) as Trida[]) for (const f of tridy[t]) kde.set(f, [...(kde.get(f) ?? []), t]);
  for (const [f, ts] of kde) if (ts.length > 1) vady.push(`${f}: je ve více třídách (${ts.join(", ")})`);
  for (const f of funkce) {
    if (dynamickeNadSledovanou(f)) vady.push(`${f.jmeno}: skládá dynamické SQL (EXECUTE) a jmenuje sledovanou tabulku — tohle brána nepřečte; dotaz napiš staticky`);
    if (sahaNaSledovane(f) && f.definer && !kde.has(f.jmeno)) {
      vady.push(
        `${f.jmeno}: SECURITY DEFINER sahá na sledovanou tabulku a není zařazená — čtenář patří do DOMOV ` +
          "(domov viditelnosti / expert_rule_visible_to s připnutou identitou), položky jednoho příběhu do PRIBEH, pohled správy do SPRAVA, " +
          "interní dráha jen pro službu do SLUZBA, zapisovatel do ZAPIS, otisk do ODVOZENI",
      );
    }
  }
  const podleJmena = new Map<string, Funkce[]>();
  for (const f of funkce) podleJmena.set(f.jmeno, [...(podleJmena.get(f.jmeno) ?? []), f]);
  for (const [jmeno, ts] of kde) {
    const fce = podleJmena.get(jmeno);
    if (!fce) {
      vady.push(`${jmeno}: je ve třídě ${ts[0]}, ale funkce neexistuje — smaž ji ze seznamu`);
      continue;
    }
    for (const f of fce) {
      if (!sahaNaSledovane(f)) {
        vady.push(`${jmeno}: je ve třídě ${ts[0]}, ale sledované tabulky už nejmenuje — smaž ji ze seznamu`);
        continue;
      }
      const v = vadaTridy(ts[0], f);
      if (v) vady.push(`${jmeno} (třída ${ts[0]}): ${v}`);
    }
  }
  return vady;
}

type Politika = { klic: string; role: string[]; using: string };
function rozborPolitik(soubory: Record<string, string>): Politika[] {
  const out: Politika[] = [];
  for (const kod of Object.values(soubory)) {
    for (const m of kod.matchAll(/CREATE\s+POLICY\s+("?)([^"\s]+)\1\s+ON\s+(?:public\.)?(knowledge_items|expert_rules)\b([\s\S]*?);/gi)) {
      const telo = m[4];
      if (!/\bFOR\s+(?:SELECT|ALL)\b/i.test(telo) && /\bFOR\s+\w+/i.test(telo)) continue;
      const role = (/\bTO\s+([a-z_,\s]+?)\s+USING\b/i.exec(telo)?.[1] ?? "public").split(",").map((r) => r.trim().toLowerCase());
      out.push({ klic: `${m[3]}.${m[2]}`, role, using: /\bUSING\s*\(([\s\S]*)\)\s*(?:WITH\s+CHECK[\s\S]*)?$/i.exec(telo.trim())?.[1] ?? "" });
    }
  }
  return out;
}
const MNOZINA = /visibility\s*=\s*ANY\s*\(\s*\(\s*SELECT\s+public\.knowledge_visibilities_for_caller\(\)\s*\)\s*::\s*text\[\]\s*\)/gi;
function vadaPolitiky(p: Politika, trida: "GLOBALNI" | "PRIBEH" | "SPRAVA" | undefined): string | null {
  if (!p.role.some((r) => ["anon", "authenticated", "public"].includes(r))) return null;
  if (!trida) return `${p.klic}: politika SELECT pro ${p.role.join(", ")} není zařazená (GLOBALNI se ptá domova, PRIBEH jen položky příběhu, SPRAVA jen správa)`;
  const u = bezRetezcu(p.using);
  if (/\bvisibility\s*(?:IN\s*\(|=|<>|!=)/i.test(u.replace(MNOZINA, " "))) return `${p.klic}: nese vlastní výčet viditelností — ptej se domova`;
  if (OBCHVAT.some((re) => re.test(u))) return `${p.klic}: obchvatná větev`;
  switch (trida) {
    case "GLOBALNI":
      if (p.klic.startsWith("knowledge_items.") && !/\bstory_id\s+IS\s+NULL\b/i.test(u)) return `${p.klic}: globální politika nemá story_id IS NULL`;
      if (p.klic.startsWith("expert_rules.") && !/\bstatus\s*=\s*''/i.test(u)) return `${p.klic}: politika pravidel nemá status = 'published'`;
      MNOZINA.lastIndex = 0;
      if (!MNOZINA.test(u)) return `${p.klic}: globální politika se neptá domova viditelnosti (visibility = ANY ((SELECT public.knowledge_visibilities_for_caller())::text[]))`;
      MNOZINA.lastIndex = 0;
      return null;
    case "PRIBEH":
      if (!/\bstory_id\s+IS\s+NOT\s+NULL\b/i.test(u)) return `${p.klic}: politika příběhu nemá story_id IS NOT NULL`;
      if (p.role.includes("anon") || p.role.includes("public")) return `${p.klic}: položky příběhu anonymovi`;
      return null;
    case "SPRAVA":
      if (!/^\s*\(?\s*SELECT\s+public\.is_admin_or_staff\(\)\s*\)?\s*$/i.test(u)) return `${p.klic}: politika správy má mít jen stráž správy`;
      return null;
  }
}

const nacti = (adr: string) =>
  Object.fromEntries(
    readdirSync(adr)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => [f, stripSqlComments(readFileSync(join(adr, f), "utf-8"))]),
  ) as Record<string, string>;

describe("znalosti a expertní pravidla: každá cesta čtení je zařazená a domov viditelnosti neobejde", () => {
  const funkce = rozdelNaFunkce(nacti(FUNKCE));
  const politiky = nacti(POLITIKY);

  it("měřák vidí funkce nad sledovanými tabulkami (kotva)", () => {
    const nad = funkce.filter((f) => sahaNaSledovane(f) && f.definer).map((f) => f.jmeno);
    expect(nad.length, "měřák nenašel funkce nad sledovanými tabulkami — míří jinam").toBeGreaterThanOrEqual(70);
    for (const f of ["mcp_search_knowledge_v2", "mcp_get_knowledge_item", "compose_context", "get_expert_rule_detail", "mcp_get_rule_detail", "get_expert_rules"]) expect(nad).toContain(f);
  });

  it("kotva měřidla: podoby jména tabulky, dynamické SQL a dělení na funkce", () => {
    const f = (telo: string, granty = "", jmeno = "f", hlavicka = "RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER") =>
      `CREATE FUNCTION public.${jmeno}() ${hlavicka} AS $$ ${telo} $$;${granty}`;
    const jedna = (telo: string) => rozdelNaFunkce({ x: f(telo) })[0];
    for (const t of [
      "SELECT 1 FROM public.knowledge_items ki",
      'SELECT 1 FROM "knowledge_items" ki',
      'SELECT 1 FROM public."expert_rules" er',
      "SELECT 1 FROM public.partner_profiles pp, public.knowledge_items ki",
      "SELECT 1 FROM (public.expert_rules er JOIN public.partner_profiles pp ON pp.id = er.author_partner_id)",
    ]) {
      expect(sahaNaSledovane(jedna(t)), t).toBe(true);
    }
    expect(sahaNaSledovane(jedna("SELECT public.get_knowledge_items_for_embedding(1); SELECT 1 FROM public.expert_rule_versions v"))).toBe(false);
    expect(sahaNaSledovane(jedna("SELECT jsonb_build_object('zdroj', 'knowledge_items')"))).toBe(false);
    expect(dynamickeNadSledovanou(jedna("EXECUTE format('SELECT 1 FROM %I', 'knowledge_items')"))).toBe(true);
    expect(dynamickeNadSledovanou(jedna("EXECUTE 'SELECT 1 FROM expert_rules'"))).toBe(true);
    expect(dynamickeNadSledovanou(jedna("PERFORM 1"))).toBe(false);
    // Dvě funkce v jednom souboru = dvě funkce.
    const dve = rozdelNaFunkce({ x: f("SELECT 1 FROM public.knowledge_items ki", "", "a") + f("SELECT 1 FROM public.knowledge_items ki", "", "b") });
    expect(dve.map((x) => x.jmeno)).toEqual(["a", "b"]);
    // Příkaz, kde je tabulka jen cílem zápisu, ji nečte; čárkový join čte.
    expect(jenZapis("UPDATE public.knowledge_items SET usage_count = usage_count + 1 WHERE id = x", ZNAL_RE)).toBe(true);
    expect(jenZapis("UPDATE public.knowledge_items ki SET a = 1 FROM public.knowledge_items k2 WHERE true", ZNAL_RE)).toBe(false);
  });

  it("kotva měřidla DOMOV: identita připnutá, gilda a správa z domovů, příkaz po příkazu, bez obchvatu", () => {
    const VIS = "public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild)";
    const STAV = "public.knowledge_state_readable(ki.quarantine_status)";
    const ZAKLAD =
      "v_audience_user := CASE WHEN public.get_jwt_role() = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid()) ELSE auth.uid() END; " +
      "v_in_guild := public.knowledge_audience_in_guild(v_audience_user); ";
    const fce = (telo: string) => rozdelNaFunkce({ x: `CREATE FUNCTION public.f() RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER AS $$ ${telo} $$;` })[0];
    const ok = fce(`${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ki.story_id IS NULL AND ${VIS} AND ${STAV};`);
    expect(vadaDomov(ok)).toBeNull();
    // druhý příkaz čte tabulku bez domova (i čárkovým joinem / v závorkách / v uvozovkách)
    expect(vadaDomov(fce(`${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ${VIS} AND ${STAV}; RETURN QUERY SELECT k.id FROM public.partner_profiles pp, "knowledge_items" k;`))).toContain("nevolá domov");
    // bez filtru stavu
    expect(vadaDomov(fce(`${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ${VIS};`))).toContain("čitelného stavu");
    // obchvat podle role
    expect(vadaDomov(fce(`${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE (${VIS} OR v_caller_role = 'anon') AND ${STAV};`))).toContain("obchvatná větev");
    // podvržené publikum
    expect(vadaDomov(fce(`v_audience_user := p_audience_user_id; v_in_guild := public.knowledge_audience_in_guild(v_audience_user); RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ${VIS} AND ${STAV};`))).toContain("publikum smí jmenovat jen služba");
    // gilda vlastním EXISTS
    expect(vadaDomov(fce(`${ZAKLAD.replace("public.knowledge_audience_in_guild(v_audience_user)", "EXISTS (SELECT 1 FROM public.partner_profiles pp WHERE pp.user_id = v_audience_user)")} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ${VIS} AND ${STAV};`))).toContain("knowledge_audience_in_guild");
    // správa konstantou
    expect(vadaDomov(fce(`${ZAKLAD} v_is_admin := true; RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE (v_is_admin OR ${VIS}) AND ${STAV};`))).toContain("is_admin_or_staff");
    // pravidla bez pomocníka / s podvrženým publikem
    expect(vadaDomov(fce("RETURN QUERY SELECT er.id FROM public.expert_rules er WHERE er.status = 'published';"))).toContain("expert_rule_visible_to");
    expect(vadaDomov(fce("RETURN QUERY SELECT er.id FROM public.expert_rules er WHERE public.expert_rule_visible_to(er.visibility, er.author_partner_id, p_audience_user_id);"))).toContain("je parametr");
    expect(vadaDomov(fce("RETURN QUERY SELECT er.id FROM public.expert_rules er WHERE public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid());"))).toBeNull();
    expect(vadaDomov(fce("RETURN QUERY SELECT er.id FROM public.expert_rules er WHERE public.expert_rule_visible_to(er.visibility, er.author_partner_id, NULL::uuid);"))).toBeNull();
    // výjimka podle typu
    expect(vadaDomov(fce(`${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE (${VIS} OR (ki.story_id IS NULL AND ki.item_type::text IN ('core_value', 'personality_trait'))) AND ${STAV};`))).toContain("výjimka podle typu");
    // druhé volání domova v témž příkazu nahrazené konstantou (výchozí příběh citací: `AND true`) — počet volání to nepozná
    const DVE = `${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ((ki.story_id IS NULL AND ${VIS}) OR (ki.is_default AND ${VIS})) AND ${STAV};`;
    expect(vadaDomov(fce(DVE))).toBeNull();
    expect(vadaDomov(fce(DVE.replace(`(ki.is_default AND ${VIS})`, "(ki.is_default AND true)")))).toContain("obchvatná větev");
    expect(vadaDomov(fce(DVE.replace(`(ki.is_default AND ${VIS})`, "(true AND ki.is_default)")))).toContain("obchvatná větev");
    expect(vadaDomov(fce(DVE.replace(`(ki.story_id IS NULL AND ${VIS})`, "(ki.story_id IS NULL OR true)")))).toContain("obchvatná větev");
    // porovnání s true konstantou není (ani přes konec řádku, ani IS TRUE)
    expect(vadaDomov(fce(`${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ki.is_active = true AND ${VIS} AND ${STAV};`))).toBeNull();
    expect(vadaDomov(fce(`${ZAKLAD} RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE (ki.is_default = true\n OR ${VIS}) AND (p_x IS TRUE OR ki.y) AND ${STAV};`))).toBeNull();
  });

  it("kotva měřidla ostatních tříd a zařazení", () => {
    const fce = (navrat: string, telo: string, granty = "", jmeno = "f") => `CREATE FUNCTION public.${jmeno}() RETURNS ${navrat} LANGUAGE plpgsql SECURITY DEFINER AS $$ ${telo} $$;${granty}`;
    const vydej = (komu: string, jmeno = "f") => ` GRANT EXECUTE ON FUNCTION public.${jmeno}() TO ${komu};`;
    const prazdne: Record<Trida, readonly string[]> = { DOMOV: [], SKLADATEL: [], PRIBEH: [], AUTOR: [], SPRAVA: [], SLUZBA: [], ZAPIS: [], ODVOZENI: [] };
    const jedna = (t: Trida): Record<Trida, readonly string[]> => ({ ...prazdne, [t]: ["f"] });
    const nalez = (kod: string, tridy: Record<Trida, readonly string[]>) => vadyZarazeni(rozdelNaFunkce({ x: kod }), tridy).join(" | ");
    const CTENI = "SELECT ki.id FROM public.knowledge_items ki WHERE ki.story_id IS NULL";
    expect(nalez(fce("SETOF uuid", CTENI, vydej("authenticated")), prazdne)).toContain("není zařazená");
    // druhá definer funkce v souboru zařazené funkce je nezařazená
    expect(nalez(fce("SETOF uuid", CTENI, vydej("service_role")) + fce("SETOF uuid", CTENI, vydej("authenticated", "g"), "g"), jedna("SLUZBA"))).toContain("g: SECURITY DEFINER sahá");
    // dynamické SQL
    expect(nalez(fce("void", "EXECUTE 'DELETE FROM knowledge_items'", vydej("service_role")), prazdne)).toContain("dynamické SQL");
    const sprava = fce("jsonb", `IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'x'; END IF; ${CTENI};`, vydej("authenticated"));
    expect(nalez(sprava, jedna("SPRAVA"))).toBe("");
    expect(nalez(fce("jsonb", `${CTENI};`, vydej("authenticated")), jedna("SPRAVA"))).toContain("bez stráže správy");
    expect(nalez(fce("SETOF uuid", `${CTENI};`, vydej("service_role") + vydej("authenticated")), jedna("SLUZBA"))).toContain("i jiným rolím");
    const pribeh = fce("SETOF uuid", "IF NOT public.is_admin_or_staff(v_user_id) THEN RAISE EXCEPTION 'x'; END IF; RETURN QUERY SELECT ki.id FROM public.knowledge_items ki WHERE ki.story_id = p_story_id;", vydej("authenticated"));
    expect(nalez(pribeh, jedna("PRIBEH"))).toBe("");
    expect(nalez(pribeh.replace("ki.story_id = p_story_id", "(ki.story_id = p_story_id OR ki.story_id IS NULL)"), jedna("PRIBEH"))).toContain("globální položky");
    const zapis = (navrat: string, granty: string) => fce(navrat, "SELECT 1 FROM public.knowledge_items ki; UPDATE public.knowledge_items SET status = 'archived';", granty);
    expect(nalez(zapis("uuid", vydej("authenticated")), jedna("ZAPIS"))).toBe("");
    expect(nalez(zapis("jsonb", vydej("authenticated")), jedna("ZAPIS"))).toContain("bez stráže správy");
    const odv = (telo: string) => fce("jsonb", telo, vydej("authenticated"));
    expect(nalez(odv("SELECT md5(string_agg(er.slug || er.ai_instructions, '|')) INTO v FROM public.expert_rules er;"), jedna("ODVOZENI"))).toBe("");
    expect(nalez(odv("SELECT jsonb_agg(er.title) INTO v FROM public.expert_rules er;"), jedna("ODVOZENI"))).toContain("obsahové sloupce");
    const autor = fce("SETOF uuid", "SELECT pp.id INTO v_partner_id FROM partner_profiles pp WHERE pp.user_id = auth.uid(); RETURN QUERY SELECT er.id FROM public.expert_rules er WHERE er.author_partner_id = v_partner_id;", vydej("authenticated"));
    expect(nalez(autor, jedna("AUTOR"))).toBe("");
    expect(nalez(autor.replace("WHERE er.author_partner_id = v_partner_id", "WHERE true"), jedna("AUTOR"))).toContain("autora");
    expect(nalez(fce("void", "SELECT 1"), jedna("DOMOV"))).toContain("už nejmenuje");
    expect(vadyZarazeni([], jedna("DOMOV")).join(" | ")).toContain("neexistuje");
    expect(nalez(fce("SETOF uuid", CTENI), { ...prazdne, DOMOV: ["f"], SLUZBA: ["f"] })).toContain("ve více třídách");
  });

  it("kotva měřidla skladatele: žadatel všem čtenářům, připnutý žadatel, z tabulek jen vektor, pravidla se žadatelem", () => {
    const kod = readFileSync(join(FUNKCE, "compose_context.sql"), "utf-8");
    const vada = (s: string) => vadaTridy("SKLADATEL", rozdelNaFunkce({ x: stripSqlComments(s) })[0]);
    expect(vada(kod)).toBeNull();
    expect(vada(kod.replace("public.fn_get_tao_principles(p_audience_user_id := v_requester)", "public.fn_get_tao_principles()"))).toContain("bez žadatele");
    expect(vada(kod.replace(/v_requester\s*:=\s*CASE[\s\S]*?END;/, "v_requester := COALESCE(p_requester_id, auth.uid());"))).toContain("publikum smí jmenovat jen služba");
    expect(vada(kod.replace("public.expert_rule_visible_to(er.visibility, er.author_partner_id, v_requester)", "true"))).toContain("pravidla rulesetu");
    expect(vada(kod.replace("RETURN jsonb_build_object(", "PERFORM 1 FROM knowledge_items ki; RETURN jsonb_build_object("))).toContain("mimo náhradní vektor");
  });

  it("každá funkce nad sledovanými tabulkami je v právě jedné třídě a drží její vlastnost", () => {
    expect(
      vadyZarazeni(funkce, TRIDY),
      "Funkce SECURITY DEFINER, která sahá na knowledge_items / knowledge_chunks / knowledge_embeddings / expert_rules, musí být " +
        "zařazená v TRIDY (tato brána) a držet vlastnost své třídy. Nepřihlášený vidí jen public, members jen přihlášený, guild jen gilda " +
        "(pravidlo majitele 2026-10-04, gilda G1 2026-10-05).",
    ).toEqual([]);
  });

  it("každá politika SELECT nad knowledge_items a expert_rules pro role API je zařazená a globální se ptá domova", () => {
    const vsechny = rozborPolitik(politiky);
    expect(vsechny.length, "měřák politik nenašel politiky").toBeGreaterThanOrEqual(6);
    expect(vsechny.map((p) => vadaPolitiky(p, POLITIKY_TRIDY[p.klic])).filter(Boolean)).toEqual([]);
    for (const k of Object.keys(POLITIKY_TRIDY)) expect(vsechny.map((p) => p.klic), `${k}: zařazená politika neexistuje — smaž ji ze seznamu`).toContain(k);
    const pol = (tab: string, to: string, using: string) => rozborPolitik({ x: `CREATE POLICY x ON public.${tab} AS PERMISSIVE FOR SELECT TO ${to} USING (${using});` })[0];
    const MN = "visibility = ANY ((SELECT public.knowledge_visibilities_for_caller())::text[])";
    expect(vadaPolitiky(pol("knowledge_items", "anon", "status = 'active' AND story_id IS NULL AND visibility IN ('public', 'members')"), "GLOBALNI")).toContain("vlastní výčet");
    expect(vadaPolitiky(pol("knowledge_items", "anon", "story_id IS NULL AND status = 'active'"), "GLOBALNI")).toContain("neptá domova");
    expect(vadaPolitiky(pol("knowledge_items", "anon", `story_id IS NULL AND ${MN}`), "GLOBALNI")).toBeNull();
    expect(vadaPolitiky(pol("expert_rules", "anon", `status = 'published' AND ${MN}`), "GLOBALNI")).toBeNull();
    expect(vadaPolitiky(pol("expert_rules", "anon", `${MN}`), "GLOBALNI")).toContain("status = 'published'");
    expect(vadaPolitiky(pol("expert_rules", "authenticated", `status = 'published' AND (${MN} OR true)`), "GLOBALNI")).toContain("obchvatná");
    expect(vadaPolitiky(pol("knowledge_items", "authenticated", "story_id IS NULL OR is_owner"), undefined)).toContain("není zařazená");
  });

  it("statistiky (SPRAVA, jen služba) vydává nástroj MCP jen správě (kotva služby)", () => {
    const kod = readFileSync(MCP, "utf-8");
    const admin = /const ADMIN_TOOLS = new Set<string>\(\[([\s\S]*?)\]\)/.exec(kod)?.[1] ?? "";
    expect(admin, "ADMIN_TOOLS v routes/mcp.ts nenalezeno").not.toBe("");
    for (const t of ["get_knowledge_stats", "admin_health_check"]) expect(admin, `${t} musí být nástroj jen pro správu`).toContain(`'${t}'`);
  });
});
