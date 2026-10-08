#!/usr/bin/env node
/**
 * gen-knowledge-seed.mjs — znalosti ze zkušenosti: `<slug>.md` → seed SQL knowledge_items.
 *
 * PROČ
 * Zkušenost z provozu a vývoje se stává znalostí AISHY ve VÝCHOZÍM příběhu
 * (story_id NULL), který dostane každý fork. Znalost se píše v čitelném tvaru
 * (jeden soubor = jedna položka, hlavička + tělo v markdownu), ne ručně psaným
 * SQL, a SQL se z ní GENERUJE. Jeden generátor pro dvě vrstvy:
 *
 *   platforma — obecné poučení platné pro každý fork. Zdroje `aisha/knowledge/*.md`,
 *               výstup `aisha/db/seed/core/41_aisha_knowledge_from_experience.sql`
 *               (core seed → každá instance při každém nasazení). Repo je veřejné
 *               (ELv2), proto `visibility: public` a žádné jméno instance.
 *   instance  — znalost jedné instance (její stroje, adresy, rozhodnutí o jejím
 *               provozu). Zdroje a výstup žijí v soukromém datovém repu instance;
 *               to volá TENTO nástroj z checkoutu platformy (`--vrstva instance
 *               --zdroj … --cil …`), žádnou vlastní kopii.
 *
 * Použití:
 *   node scripts/db/gen-knowledge-seed.mjs            # platforma: přepíše seed
 *   node scripts/db/gen-knowledge-seed.mjs --check    # jen porovná; rozdíl = kód 1
 *   node scripts/db/gen-knowledge-seed.mjs --vrstva instance --zdroj <dir> --cil <soubor.sql> [--check]
 *   … --vyzaduj-jmena   prázdný seznam jmen instancí = chyba (NEZMĚŘENO není čisto)
 *   npm run db:seed:knowledge
 *
 * TVAR POLOŽKY (`<slug>.md`, README.md v adresáři zdrojů se nečte):
 *   ---
 *   slug: stale-jmeno            povinné; = jméno souboru; id = md5('ki-' || source_type || ':' || slug)
 *   title: "…"                   povinné
 *   summary: "…"                 povinné
 *   category: nazev              povinné ([a-z0-9_])
 *   item_type: playbook          volitelné; výchozí engineering_doc; ověřuje se proti
 *                                výčtu knowledge_item_type (ITEM_TYPES níž)
 *   tags: [a, b]                 povinné, aspoň jeden
 *   verified: measured | read    povinné; measured = ověřeno pokusem (→ is_verified)
 *   verified_note: "…"           volitelné; co bylo změřeno a co jen čteno
 *   evidence:                    povinné, aspoň jeden řádek; `file: <cesta>` = soubor
 *     - file: scripts/…            v checkoutu platformy, generátor ověří, že existuje
 *     - text důkazu
 *   valid_for: "…"               povinné
 *   scope: general | instance    povinné; musí sedět s vrstvou
 *   visibility: public           platforma jen public (výchozí); instance výslovně, povolené
 *                                viditelnosti viz VRSTVY.instance (rozšiřují se jen s DB zkouškou)
 *   status: adopted              povinné, viz STAVY
 *   author: kdo                  povinné
 *   ai_instructions: "…"         povinné: kdy a jak má asistent položku použít
 *   ---
 *   tělo v markdownu
 *
 * STAVY (`status`): do seedu jdou jen `adopted` (→ active) a `retired` (→ archived,
 * odebrání položky z existujících DB je vědomý krok, ne smazání souboru).
 * `proposed`, `draft` a `returned` se NEgenerují — a hlavička seedu je vyjmenuje,
 * aby vynechání nebylo tiché. Smazaný soubor generátor z DB neodebere.
 *
 * ZÁPIS DO DB: `ON CONFLICT (id) DO UPDATE` s verzí, ne DO NOTHING. Seed se aplikuje
 * při KAŽDÉM nasazení i na existující DB (docker-migrate-entrypoint.sh: migrate →
 * compile-seed → db:seed); s DO NOTHING by se oprava položky do existující DB nikdy
 * nedostala (tak to má ručně psaný 35_aisha_platform_self_knowledge.sql — jeho
 * opravy dorazí jen na čistou DB). Řádek se přepíše a verze zvedne JEN když se obsah
 * liší (IS DISTINCT FROM) — opakované použití nic nemění a nespouští znovu embedding
 * (trg_knowledge_embedding_auto). Zdrojem pravdy jsou soubory; ruční úprava řádku v DB
 * se při dalším nasazení vrátí. Karanténa (quarantine_*) se nepřepisuje — je to
 * rozhodnutí bezpečnostního skenu, ne obsahu.
 * Řádky mají vyhrazený source_type (platform_knowledge / instance_knowledge, viz
 * VYHRAZENE_ZDROJE): vlastní jmenný prostor slugů a zápis jen seedem, takže kolizi slugu
 * nikdo bez práv služby nevyrobí. Blok $straz$ chytá jen stav po ručním zásahu.
 *
 * Co generátor NEDĚLÁ: nepočítá vektory (dopočítá je platforma po zápisu) a nemaže.
 *
 * @module
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { porovnej } from "../lib/razeni.mjs";
import { allTenantNames, privateSentinelHits } from "../lib/tenant-sentinels.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const PLATFORM_SOURCE_DIR = path.join(ROOT, "aisha/knowledge");
export const PLATFORM_OUTPUT_FILE = path.join(ROOT, "aisha/db/seed/core/41_aisha_knowledge_from_experience.sql");

/**
 * Výčet `knowledge_item_type` (SoT aisha/db/sql/enums/knowledge_item_type.sql) a co
 * s každou hodnotou smí tenhle generátor. Třídní brána
 * (src/tests/gates/knowledge-seed-from-sources.gate.test.ts) drží klíče = výčet v SoT
 * i v baseline: nová hodnota výčtu tu bez rozhodnutí neprojde.
 *   zapis  — generátor zapisuje (upsert).
 *   null   — odmítnuto; text říká proč a kudy vede správná cesta.
 */
export const ITEM_TYPES = Object.freeze({
  engineering_doc: "zapis",
  domain_doc: "zapis",
  playbook: "zapis",
  case_study: "zapis",
  expert_rule:
    "pravidlo expertů patří do expert_rules (vzor aisha/db/seed/core/38_anthropic_operating_principles.sql); " +
    "knowledge_items tohoto typu jsou zrcadla, která píše trg_sync_expert_rule_to_knowledge",
  core_value:
    "hodnoty jsou po vložení neměnné (trigger fn_protect_core_values) — upsert by opravu nedoručil, " +
    "jen shodil seed; jejich cesta je vrstva osobnosti (24_aisha_personality / 25_aisha_tao)",
  personality_trait:
    "rysy osobnosti jsou po vložení neměnné (trigger fn_protect_psyche_traits) — upsert by opravu " +
    "nedoručil, jen shodil seed; jejich cesta je vrstva osobnosti",
});
export const DEFAULT_ITEM_TYPE = "engineering_doc";

/** Stav položky → stav řádku v DB; `null` = do seedu nejde (a hlavička to řekne). */
export const STAVY = Object.freeze({
  adopted: "active",
  retired: "archived",
  proposed: null,
  draft: null,
  returned: null,
});

/**
 * Vrstvy. `visibility` platformy je jen public: repo je veřejné, nic v něm není
 * soukromé, a „members" u položky bez příběhu by slibovalo soukromí, které
 * veřejný zdroj nemá. Klasifikace podle docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md
 * se zrcadlí do ai_context_tags (vzor 38/39 v seed/core).
 */
/**
 * Vyhrazené zdroje: řádky těchto source_type zapisuje JEN seed z repozitáře. Databáze to drží
 * konstrukcí, ne jen hlasitě: vlastní jmenný prostor slugů (idx_knowledge_items_reserved_
 * slug_unique; globální index nad (source_slug, locale) je vynechává, takže nikdo, kdo smí
 * založit položku se slugem, neobsadí slug, který platforma přidá později) a trigger
 * trg_protect_reserved_knowledge, který koncovému uživateli zápis odmítne i přes definer RPC.
 * Brána knowledge-seed-from-sources drží tento výčet shodný se všemi místy v SQL.
 */
export const VYHRAZENE_ZDROJE = Object.freeze({ platforma: "platform_knowledge", instance: "instance_knowledge" });

export const VRSTVY = Object.freeze({
  platforma: {
    sourceType: VYHRAZENE_ZDROJE.platforma,
    scope: "general",
    viditelnosti: ["public"],
    vychoziViditelnost: "public",
    kontrolaJmen: true,
  },
  instance: {
    sourceType: VYHRAZENE_ZDROJE.instance,
    scope: "instance",
    // Viditelnost se ve vrstvě instance povoluje JEN spolu s DB zkouškou cest čtení
    // (src/tests/db/znalosti-viditelnost-cesty-cteni.runtime.test.ts): zkouška měří každou
    // viditelnost z tohoto seznamu na všech cestách čtení (tabulka pod RLS, hledání v2 a v3,
    // čtení podle id, compose_context) pod anonymem, přihlášeným a správou. Přidání sem bez
    // zelené zkoušky je červená, ne tichý únik. Výchozí hodnota není: autor ji píše výslovně.
    viditelnosti: ["public"],
    vychoziViditelnost: null,
    kontrolaJmen: false,
  },
});

/** Viditelnosti, které generátor zná, ale vrstva instance je zatím nepovoluje — a proč. */
export const VIDITELNOSTI_CEKAJICI = Object.freeze({
  members:
    "zatím nepovoleno — „members“ smí vidět jen přihlášený; povolí se spolu se zelenou DB zkouškou " +
    "cest čtení pro tuto viditelnost (src/tests/db/znalosti-viditelnost-cesty-cteni.runtime.test.ts)",
  guild:
    "zatím nepovoleno — povolí se spolu se zelenou DB zkouškou cest čtení pro tuto viditelnost " +
    "(src/tests/db/znalosti-viditelnost-cesty-cteni.runtime.test.ts)",
  private:
    "zatím nepovoleno — položka bez příběhu s „private“ smí vidět jen správa; povolí se spolu se zelenou " +
    "DB zkouškou cest čtení pro tuto viditelnost (src/tests/db/znalosti-viditelnost-cesty-cteni.runtime.test.ts)",
});

const POVINNA = ["slug", "title", "summary", "category", "tags", "verified", "evidence", "valid_for", "scope", "status", "author", "ai_instructions"];
const ZNAMA = new Set([...POVINNA, "item_type", "visibility", "verified_note"]);

export class Vada extends Error {}

/** Jedna hodnota hlavičky: v uvozovkách doslova, bez nich končí před „  # komentář". */
function hodnota(text) {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t.startsWith('"')) {
    const konec = t.lastIndexOf('"');
    if (konec > 0) return t.slice(1, konec);
  }
  return t.replace(/\s+#.*$/, "").trim();
}

/**
 * Přečte jednu položku. Vrací pole hlavičky + `_telo` + `_soubor`.
 * @param {string} text
 * @param {string} soubor jméno souboru (pro hlášky a kontrolu slugu)
 */
export function parseItem(text, soubor) {
  const radky = text.replace(/\r\n/g, "\n").split("\n");
  if (radky[0]?.trim() !== "---") throw new Vada(`${soubor}: soubor nezačíná hlavičkou (---)`);
  const konec = radky.findIndex((r, i) => i > 0 && r.trim() === "---");
  if (konec === -1) throw new Vada(`${soubor}: hlavička není ukončená (---)`);
  const pole = {};
  let posledni = null;
  for (const r of radky.slice(1, konec)) {
    if (!r.trim() || r.trimStart().startsWith("#")) continue;
    let m = r.match(/^([a-z_]+):\s*(.*)$/);
    if (m) {
      posledni = m[1];
      const zbytek = m[2];
      if (!ZNAMA.has(posledni)) throw new Vada(`${soubor}: neznámé pole hlavičky \`${posledni}\``);
      if (posledni in pole) throw new Vada(`${soubor}: pole \`${posledni}\` je v hlavičce dvakrát`);
      if (posledni === "tags") {
        const ob = zbytek.trim().match(/^\[(.*)\]/);
        if (!ob) throw new Vada(`${soubor}: \`tags\` musí být seznam v hranatých závorkách`);
        pole.tags = ob[1].split(",").map((t) => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
      } else if (posledni === "evidence") {
        pole.evidence = zbytek.trim() ? [hodnota(zbytek)] : [];
      } else {
        pole[posledni] = hodnota(zbytek);
      }
      continue;
    }
    m = r.match(/^\s+-\s+(.*)$/);
    if (m && posledni === "evidence") {
      pole.evidence.push(hodnota(m[1]));
      continue;
    }
    throw new Vada(`${soubor}: řádku hlavičky nerozumím: ${JSON.stringify(r)}`);
  }
  pole._telo = radky.slice(konec + 1).join("\n").trim() + "\n";
  pole._soubor = soubor;
  return pole;
}

/** Texty položky, které jdou do DB (a tedy podléhají kontrole jmen). */
function textyPolozky(p) {
  return [
    p.slug, p.title, p.summary, p.category, p.ai_instructions, p._telo, p.valid_for, p.author,
    p.verified_note ?? "", ...(p.tags ?? []), ...(p.evidence ?? []),
  ];
}

/**
 * Ověří položku pro vrstvu. Doplní výchozí item_type a visibility.
 * @param {Record<string, any>} p
 * @param {keyof typeof VRSTVY} vrstva
 * @param {{ jmena?: string[], koren?: string }} [volby]
 */
export function validateItem(p, vrstva, { jmena = [], koren = ROOT } = {}) {
  const s = p._soubor;
  const v = VRSTVY[vrstva];
  if (!v) throw new Vada(`neznámá vrstva ${JSON.stringify(vrstva)} (platforma | instance)`);
  const chybi = POVINNA.filter((k) => (Array.isArray(p[k]) ? p[k].length === 0 : !p[k]));
  if (chybi.length) throw new Vada(`${s}: chybí povinná pole: ${chybi.join(", ")}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) throw new Vada(`${s}: slug smí nést jen malá písmena, číslice a spojovníky`);
  if (`${p.slug}.md` !== s) throw new Vada(`${s}: jméno souboru se musí rovnat slugu (${p.slug}.md)`);
  if (!/^[a-z][a-z0-9_]*$/.test(p.category)) throw new Vada(`${s}: category ${JSON.stringify(p.category)} není [a-z][a-z0-9_]*`);
  for (const t of p.tags) {
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(t)) throw new Vada(`${s}: štítek ${JSON.stringify(t)} není [a-z0-9][a-z0-9._:-]*`);
  }
  p.item_type ??= DEFAULT_ITEM_TYPE;
  if (!(p.item_type in ITEM_TYPES)) {
    throw new Vada(`${s}: item_type ${JSON.stringify(p.item_type)} není z výčtu knowledge_item_type (${Object.keys(ITEM_TYPES).join(", ")})`);
  }
  if (ITEM_TYPES[p.item_type] !== "zapis") throw new Vada(`${s}: item_type ${p.item_type} tímto generátorem nejde — ${ITEM_TYPES[p.item_type]}`);
  if (!["measured", "read"].includes(p.verified)) throw new Vada(`${s}: verified musí být measured nebo read, je ${JSON.stringify(p.verified)}`);
  if (!(p.status in STAVY)) throw new Vada(`${s}: status ${JSON.stringify(p.status)} není z ${Object.keys(STAVY).join(", ")}`);
  if (p.scope !== v.scope) {
    throw new Vada(
      `${s}: scope ${JSON.stringify(p.scope)} do vrstvy ${vrstva} nepatří (čeká ${v.scope}) — ` +
        (vrstva === "instance"
          ? "obecné poučení patří do platformy (aisha/knowledge/ v repu platformy)"
          : "znalost jedné instance patří do jejího datového repa"),
    );
  }
  if (!p.visibility && !v.vychoziViditelnost) {
    throw new Vada(`${s}: vrstva ${vrstva} chce visibility výslovně (${v.viditelnosti.join(" | ")})`);
  }
  p.visibility ??= v.vychoziViditelnost;
  if (!v.viditelnosti.includes(p.visibility) && VIDITELNOSTI_CEKAJICI[p.visibility]) {
    throw new Vada(`${s}: visibility ${p.visibility} ve vrstvě ${vrstva} — ${VIDITELNOSTI_CEKAJICI[p.visibility]}`);
  }
  if (!v.viditelnosti.includes(p.visibility)) {
    throw new Vada(`${s}: visibility ${JSON.stringify(p.visibility)} do vrstvy ${vrstva} nepatří (${v.viditelnosti.join(" | ")})`);
  }
  if (p._telo.trim().length < 40) throw new Vada(`${s}: tělo položky je prázdné nebo příliš krátké`);
  for (const e of p.evidence) {
    const m = e.match(/^file:\s*(\S+)/);
    if (m && !existsSync(path.join(koren, m[1].replace(/[#@].*$/, "")))) {
      throw new Vada(`${s}: důkaz \`file: ${m[1]}\` v checkoutu platformy neexistuje — odkaz musí jít přečíst`);
    }
  }
  if (v.kontrolaJmen && jmena.length) {
    const nalez = [];
    for (const [i, jmeno] of jmena.entries()) {
      if (privateSentinelHits(textyPolozky(p).join("\n"), [jmeno]).length) nalez.push(i + 1);
    }
    // Jméno se NEVYPISUJE: výpis brány ve veřejném CI by ho prozradil. Pořadí v
    // seznamu stačí tomu, kdo seznam drží.
    if (nalez.length) throw new Vada(`${s}: obecná položka nese jméno instance (pořadí v seznamu jmen: ${nalez.join(", ")})`);
  }
  return p;
}

/** id = md5('ki-' || source_type || ':' || slug) jako uuid. Každá vrstva má vlastní id
 *  (i vlastní jedinečnost slugu v idx_knowledge_items_reserved_slug_unique): táž položka
 *  ve dvou vrstvách jsou dva řádky, ne jeden, který by si vrstvy při každém nasazení
 *  přepisovaly. Přesun položky mezi vrstvami = nový řádek; starý odebere jeho vrstva
 *  (status: retired). */
export function idPolozky(slug, sourceType) {
  if (!Object.values(VYHRAZENE_ZDROJE).includes(sourceType)) {
    throw new Vada(`idPolozky: source_type ${JSON.stringify(sourceType)} není vyhrazený zdroj (${Object.values(VYHRAZENE_ZDROJE).join(", ")})`);
  }
  const h = createHash("md5").update(`ki-${sourceType}:${slug}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function teloSPuvodem(p) {
  const overeno = p.verified === "measured" ? "measured by experiment" : "read only (not run here)";
  const pozn = p.verified_note ? ` — ${p.verified_note}` : "";
  return (
    p._telo.replace(/\n+$/, "") +
    "\n\n---\n" +
    `**Verification:** ${overeno}${pozn}\n` +
    `**Evidence:** ${p.evidence.join("; ")}\n` +
    `**Valid for:** ${p.valid_for}\n` +
    `**Scope:** ${p.scope} · **Source:** ${p.author}\n`
  );
}

function stitky(p) {
  const citlivost = { public: "public", members: "internal", guild: "internal", private: "restricted" }[p.visibility];
  return [
    ...new Set([
      ...p.tags,
      "knowledge-from-experience",
      `verified:${p.verified}`,
      `scope:${p.scope}`,
      "source_type:internal",
      `data_sensitivity:${citlivost}`,
      "retention_class:long_term",
      "legal_basis:legitimate_interest",
    ]),
  ];
}

/** Sloupce, které seed vlastní: zapisuje je a jen podle nich pozná změnu. */
const VLASTNENE = [
  "item_type", "source_type", "source_slug", "title", "summary", "body_markdown", "ai_instructions",
  "ai_context_tags", "category", "status", "visibility", "is_verified", "author_display_name", "story_id",
];

function sqlPolozky(p, zdrojRel, sourceType) {
  const sloupce = VLASTNENE.map((c) => `  ${c} = EXCLUDED.${c},`).join("\n");
  const stare = VLASTNENE.map((c) => `public.knowledge_items.${c}`).join(", ");
  const nove = VLASTNENE.map((c) => `EXCLUDED.${c}`).join(", ");
  return `-- ${p.slug}  (zdroj: ${zdrojRel}/${p._soubor})
INSERT INTO public.knowledge_items (
  id, item_type, source_type, source_slug,
  title, summary, body_markdown, ai_instructions, ai_context_tags,
  category, status, visibility, version, is_verified, author_display_name, published_at
) VALUES (
  ${lit(idPolozky(p.slug, sourceType))},
  ${lit(p.item_type)},
  ${lit(sourceType)},
  ${lit(p.slug)},
  ${lit(p.title)},
  ${lit(p.summary)},
  ${lit(teloSPuvodem(p))},
  ${lit(p.ai_instructions)},
  ARRAY[${stitky(p).map(lit).join(", ")}]::text[],
  ${lit(p.category)},
  ${lit(STAVY[p.status])},
  ${lit(p.visibility)},
  1,
  ${p.verified === "measured" ? "true" : "false"},
  ${lit(p.author)},
  now()
) ON CONFLICT (id) DO UPDATE SET
${sloupce}
  -- Změněný obsah ještě nikdo nezkontroloval: sken bezpečnosti ho musí projít znovu
  -- (nezměřené není čisté). Karanténu samotnou seed nepřepisuje.
  safety_scanned_at = NULL,
  version = public.knowledge_items.version + 1
WHERE (${stare})
  IS DISTINCT FROM
      (${nove});
`;
}

function straz(polozky, cilJmeno, sourceType) {
  const hodnoty = polozky.map((p) => `    (${lit(p.slug)}, ${lit(idPolozky(p.slug, sourceType))}::uuid)`).join(",\n");
  return `-- Stráž. Relace API vyhrazený zdroj nezapíše (trigger trg_protect_reserved_knowledge,
-- odmítnutí v import_story_bundle a upsert_story_knowledge_item_audited) a slug ve vyhrazeném
-- prostoru vrstvy neobsadí (idx_knowledge_items_reserved_slug_unique). Co stráž chytá, proto
-- vzniká JEN ručním zásahem pod superuživatelem nebo v datové cestě: řádek s id této položky
-- pod jiným source_type než ${sourceType}, nebo slug této vrstvy pod jiným id. Seed ho
-- nepřepíše a odmítne nahlas se jménem položky.
DO $straz$
DECLARE
  v_cizi text;
BEGIN
  SELECT string_agg(format('%s (id %s, source_type %s, story %s)', ki.source_slug, ki.id, ki.source_type,
                           coalesce(ki.story_id::text, '-')), ', ' ORDER BY ki.source_slug)
    INTO v_cizi
    FROM public.knowledge_items ki
    JOIN (VALUES
${hodnoty}
    ) AS z(slug, id)
      ON (ki.id = z.id AND ki.source_type <> ${lit(sourceType)})
      OR (ki.source_type = ${lit(sourceType)} AND ki.source_slug = z.slug AND ki.locale = 'global' AND ki.id <> z.id);
  IF v_cizi IS NOT NULL THEN
    RAISE EXCEPTION '${cilJmeno}: vyhrazený prostor znalostí nese cizí řádek: % — vzniká jen ručním zásahem; seed ho nepřepíše', v_cizi;
  END IF;
END
$straz$;
`;
}

function hlavicka({ cilJmeno, zdrojRel, vrstva, zarazene, vynechane, prikaz }) {
  const vynechano = vynechane.length
    ? vynechane.map((p) => `--   ${p.slug} (${p.status})`).join("\n")
    : "--   (žádná)";
  const popis =
    vrstva === "platforma"
      ? `-- Obecné znalosti ze zkušenosti, platné pro každý fork: story_id NULL = výchozí příběh,
-- visibility public (repo je veřejné, ELv2). Seed core → každá instance při každém nasazení.`
      : `-- Znalosti této instance (vrstva instance, story_id NULL = všechny příběhy instance).`;
  return `-- ${cilJmeno}
-- ═══════════════════════════════════════════════════════════════════════
-- GENEROVÁNO — neupravovat ručně. Zdroj: ${zdrojRel}/<slug>.md
-- Generátor: scripts/db/gen-knowledge-seed.mjs (platforma) · přegenerovat: ${prikaz}
-- ═══════════════════════════════════════════════════════════════════════
${popis}
-- Zápis: ON CONFLICT (id) DO UPDATE — řádek se přepíše a verze zvedne jen tehdy,
-- když se obsah liší; opakované použití nic nemění. Vektory se neseedují (dopočítá je
-- platforma po zápisu), karanténa se nepřepisuje.
-- Zařazeno: ${zarazene.length} · nezařazeno (stav mimo adopted/retired): ${vynechane.length}
${vynechano}
`;
}

/**
 * Sestaví seed z adresáře zdrojů.
 * @param {{ zdroj?: string, cil?: string, vrstva?: keyof typeof VRSTVY, jmena?: string[],
 *           koren?: string, slugyPlatformy?: Set<string>, prikaz?: string }} [volby]
 * @returns {{ sql: string, zarazene: object[], vynechane: object[] }}
 */
export function buildSeedSql({
  zdroj = PLATFORM_SOURCE_DIR,
  cil = PLATFORM_OUTPUT_FILE,
  vrstva = "platforma",
  jmena = [],
  koren = ROOT,
  slugyPlatformy = new Set(),
  prikaz = "npm run db:seed:knowledge",
} = {}) {
  if (!existsSync(zdroj)) throw new Vada(`adresář zdrojů ${zdroj} neexistuje — NEZMĚŘENO, nic se negeneruje`);
  const soubory = readdirSync(zdroj)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort(porovnej);
  if (!soubory.length) throw new Vada(`v ${zdroj} není žádná položka — NEZMĚŘENO, nic se negeneruje`);
  const polozky = soubory.map((f) => validateItem(parseItem(readFileSync(path.join(zdroj, f), "utf8"), f), vrstva, { jmena, koren }));
  for (const p of polozky) {
    if (slugyPlatformy.has(p.slug)) {
      throw new Vada(`${p._soubor}: slug už má platforma (aisha/knowledge/${p.slug}.md) — tatáž položka ve dvou vrstvách by se při každém nasazení přepisovala`);
    }
  }
  const zarazene = polozky.filter((p) => STAVY[p.status] !== null);
  const vynechane = polozky.filter((p) => STAVY[p.status] === null);
  const cilJmeno = path.basename(cil);
  // Cesta zdroje v SQL je relativní ke kořeni platformy; zdroj MIMO platformu (datové
  // repo instance) se uvádí jen jménem adresáře — absolutní cesta stroje do SQL nepatří
  // a seed by se jinak lišil podle toho, kde kdo repo naklonoval.
  const rel = path.relative(koren, zdroj).split(path.sep).join("/");
  const zdrojRel = !rel || rel.startsWith("..") || path.isAbsolute(rel) ? path.basename(zdroj) : rel;
  let sql = hlavicka({ cilJmeno, zdrojRel, vrstva, zarazene, vynechane, prikaz });
  if (zarazene.length) {
    sql += "\n" + straz(zarazene, cilJmeno, VRSTVY[vrstva].sourceType) + "\n" + zarazene.map((p) => sqlPolozky(p, zdrojRel, VRSTVY[vrstva].sourceType)).join("\n");
  }
  return { sql, zarazene, vynechane };
}

/** Slugy platformních položek (pro kontrolu kolize z vrstvy instance). */
export function platformSlugs(zdroj = PLATFORM_SOURCE_DIR) {
  if (!existsSync(zdroj)) return new Set();
  return new Set(readdirSync(zdroj).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => f.slice(0, -3)));
}

/** Přepínače, kterým nástroj rozumí. Neznámý je STOP (kód 2), ne výchozí režim — výchozí
 *  režim tu PŘEPISUJE soubor seedu (brána neznamy-prepinac-neni-vychozi-chovani). */
export const ZNAME_PREPINACE = new Set(["--check", "--vrstva", "--zdroj", "--cil", "--vyzaduj-jmena", "--help", "-h"]);

/** Přepínače z argv, které nástroj nezná (hodnoty za --vrstva/--zdroj/--cil se nepočítají). */
export function neznamePrepinace(args) {
  return args.filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a.split("=")[0]));
}

const NAPOVEDA = `gen-knowledge-seed — znalosti ze zkušenosti: <slug>.md → seed SQL knowledge_items
  node scripts/db/gen-knowledge-seed.mjs [--check] [--vyzaduj-jmena]
  node scripts/db/gen-knowledge-seed.mjs --vrstva instance --zdroj <adresář> --cil <soubor.sql> [--check]
Tvar položky, stavy a zápis do DB: hlavička souboru scripts/db/gen-knowledge-seed.mjs.`;

function argument(args, jmeno) {
  const eq = args.find((a) => a.startsWith(`${jmeno}=`));
  if (eq) return eq.slice(jmeno.length + 1);
  const i = args.indexOf(jmeno);
  return i === -1 ? undefined : args[i + 1];
}

/**
 * CLI. Kódy: 0 v pořádku, 1 soubor neodpovídá zdrojům (--check), 2 vadný vstup / použití.
 * `jmenaKoren` = odkud se čte config/tenant.json a instances/ (výchozí kořen platformy;
 * testy ho přesměrují, aby nezávisely na stroji).
 */
export function main(args = process.argv.slice(2), env = process.env, jmenaKoren = ROOT) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(NAPOVEDA);
    return 0;
  }
  const nezname = neznamePrepinace(args);
  if (nezname.length) {
    console.error(`gen-knowledge-seed: neznámý přepínač ${nezname.join(", ")} — nic se nezapisuje\n${NAPOVEDA}`);
    return 2;
  }
  const check = args.includes("--check");
  const vyzadujJmena = args.includes("--vyzaduj-jmena");
  const vrstva = argument(args, "--vrstva") ?? "platforma";
  try {
    if (!(vrstva in VRSTVY)) throw new Vada(`neznámá --vrstva ${JSON.stringify(vrstva)} (platforma | instance)`);
    const zdroj = argument(args, "--zdroj");
    const cil = argument(args, "--cil");
    if (vrstva === "instance" && (!zdroj || !cil)) throw new Vada("vrstva instance potřebuje --zdroj <adresář> a --cil <soubor.sql> (žádný výchozí cíl ve stromu platformy)");
    const jmena = VRSTVY[vrstva].kontrolaJmen ? allTenantNames(jmenaKoren, env) : [];
    if (VRSTVY[vrstva].kontrolaJmen && !jmena.length) {
      const zprava =
        "kontrola jmen instancí: seznam je prázdný (config/tenant.json, AISHA_TENANT_SENTINELS, instances/) — NEZMĚŘENO";
      if (vyzadujJmena) throw new Vada(`${zprava}; --vyzaduj-jmena`);
      console.error(`gen-knowledge-seed: ⚠ ${zprava}`);
    }
    const volby = {
      vrstva,
      jmena,
      ...(zdroj ? { zdroj: path.resolve(zdroj) } : {}),
      ...(cil ? { cil: path.resolve(cil) } : {}),
      ...(vrstva === "instance" ? { slugyPlatformy: platformSlugs(), prikaz: "nástroj datového repa (volá scripts/db/gen-knowledge-seed.mjs --vrstva instance)" } : {}),
    };
    const cilSoubor = volby.cil ?? PLATFORM_OUTPUT_FILE;
    const { sql, zarazene, vynechane } = buildSeedSql(volby);
    const souhrn = `${zarazene.length} zařazeno, ${vynechane.length} nezařazeno`;
    if (check) {
      const dnes = existsSync(cilSoubor) ? readFileSync(cilSoubor, "utf8") : null;
      if (dnes !== sql) {
        console.error(`gen-knowledge-seed: ${path.basename(cilSoubor)} neodpovídá zdrojům — spusť generátor (npm run db:seed:knowledge)`);
        return 1;
      }
      console.log(`gen-knowledge-seed: ${path.basename(cilSoubor)} odpovídá zdrojům (${souhrn})`);
      return 0;
    }
    writeFileSync(cilSoubor, sql);
    console.log(`gen-knowledge-seed: zapsáno ${path.basename(cilSoubor)} (${souhrn})`);
    return 0;
  } catch (e) {
    if (e instanceof Vada) {
      console.error(`gen-knowledge-seed: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

if (isDirectRun(import.meta.url)) {
  // Stráž i tady, před main(): neznámý přepínač nesmí doputovat k zápisu ani omylem.
  if (neznamePrepinace(process.argv.slice(2)).length) {
    console.error(`gen-knowledge-seed: neznámý přepínač ${neznamePrepinace(process.argv.slice(2)).join(", ")} — nic se nezapisuje`);
    process.exit(2);
  }
  process.exit(main());
}
