/**
 * Hledání ve znalostech podle IDENTITY VAH, ne jen jména modelu (P2, 2026-10-06) — RUNTIME.
 *
 * ⛔ NAMĚŘENO 2026-10-06 (riq, jen čtení): mcp_search_knowledge_v3 filtrovala vektory jen podle
 * JMÉNA modelu. Korpus nesl 126 443 starých vektorů ve 3 identitách (gguf · hf · MLX) pod týmž
 * model_id jako cílové váhy na GPU — po přepočtu by se tiše míchaly do pořadí. Měří se:
 *   1. s modelem v3 srovná dotaz JEN s vektory deklarované identity (stará identita téhož jména,
 *      vektor bez identity a jiný model se nevrátí) — obě větve (v1 i v2);
 *   2. přístup k příběhu a viditelnost platí dál (vlastní příběh ano, cizí 42501);
 *   3. nedeklarovaná identita = JEDNOTNÁ výjimka embedding_identity_undeclared bez hodnot
 *      (ani jméno modelu, ani deklarace), ne prázdný výsledek;
 *   3b. (revize bezpečnosti 2026-10-07) identitu volající nezadává — v3 nemá kde ji přijmout;
 *      cizí příběh i nepřihlášený dostanou TUTÉŽ odpověď bez ohledu na model a jeho deklaraci
 *      (kontrola přístupu běží PŘED čtením deklarace — žádné orákulum);
 *   4. JEDNA definice živého vektoru: co hledání srovná a co dopočet přepočítá, je přesný doplněk;
 *   5. pomocník deklarace: EXECUTE jen služba (i na forku s výchozím EXECUTE pro authenticated),
 *      a v3 přesto funguje pod přihlášeným (definer);
 *   6. kotva měřidla: v3 BEZ filtru identity (mutace v transakci) starý vektor vrátí — test vadu vidí.
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const PROV = `test-prov-idv-${RUN}`;
const MODEL = `test-embed-idv-${RUN}`;
const MODEL_V2 = `test-embed2-idv-${RUN}`;
const MODEL_BEZ = `test-embed-bez-${RUN}`;
const ID = `pytorch:${"a".repeat(64)}`;
const ID_STARA = `gguf:${"b".repeat(64)}`;
const ID_V2 = `safetensors:${"c".repeat(64)}`;
const ID_V2_STARA = `gguf:${"d".repeat(64)}`;
const VLASTNIK = randomUUID();
const CIZI = randomUUID();
const PRIBEH = randomUUID();
const PRIBEH_CIZI = randomUUID();
const I = { glob: randomUUID(), muj: randomUUID(), cizi: randomUUID() };
const C = Object.fromEntries(["zivy", "stary", "jinyModel", "bezIdentity", "muj", "cizi"].map((k) => [k, randomUUID()])) as Record<string, string>;
const vek1 = "array_fill(0.1::real, ARRAY[1024])::vector";
const vek2 = "array_fill(0.1::real, ARRAY[2560])::halfvec";
const SLUZBA = '{"role":"service_role"}';
const prihlaseny = (sub: string) => `{"sub":"${sub}","role":"authenticated"}`;

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: sql, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const jako = (sql: string) => {
  try {
    return { ok: true as const, out: psql(sql) };
  } catch (e) {
    return { ok: false as const, err: String((e as { stderr?: string }).stderr ?? e) };
  }
};

/** Fixture v transakci — nic nezůstane (ROLLBACK). */
const FIXTURE = `\\o /dev/null
BEGIN;
INSERT INTO aisha_auth.users (id, email) VALUES ('${VLASTNIK}', 'idv-vlastnik-${RUN}@example.invalid'), ('${CIZI}', 'idv-cizi-${RUN}@example.invalid');
INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind) VALUES ('${PROV}', 'test', 'local_vllm');
INSERT INTO public.ai_model_registry (provider, model_id, is_embedding, is_available, is_deprecated, embedding_dimensions, provider_metadata, provider_registry_id)
  SELECT '${PROV}', m.model_id, true, true, false, m.dim, m.meta::jsonb, p.id
    FROM public.ai_provider_registry p,
         (VALUES ('${MODEL}', 1024, '{"declared": {"weights_format": "pytorch", "weights_sha256": "${"a".repeat(64)}", "max_tokens": 512}}'),
                 ('${MODEL_V2}', 2560, '{"declared": {"weights_format": "safetensors", "weights_sha256": "${"c".repeat(64)}", "max_tokens": 512}}'),
                 ('${MODEL_BEZ}', 1024, '{}')) AS m(model_id, dim, meta)
   WHERE p.slug = '${PROV}';
INSERT INTO public.partner_stories (id, user_id, title) VALUES ('${PRIBEH}', '${VLASTNIK}', 'idv ${RUN}'), ('${PRIBEH_CIZI}', '${CIZI}', 'idv cizi ${RUN}');
INSERT INTO public.knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status, created_at) VALUES
  ('${I.glob}', 'domain_doc', 'idv glob ${RUN}', 'x', NULL, 'public', 'active', now() - interval '100 years'),
  ('${I.muj}', 'domain_doc', 'idv muj ${RUN}', 'x', '${PRIBEH}', 'public', 'active', now() - interval '100 years'),
  ('${I.cizi}', 'domain_doc', 'idv cizi ${RUN}', 'x', '${PRIBEH_CIZI}', 'public', 'active', now() - interval '100 years');
INSERT INTO public.knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, locale) VALUES
  ('${C.zivy}', '${I.glob}', 0, 'živý', 'global'), ('${C.stary}', '${I.glob}', 1, 'starý runtime', 'global'),
  ('${C.jinyModel}', '${I.glob}', 2, 'jiný model', 'global'), ('${C.bezIdentity}', '${I.glob}', 3, 'bez identity', 'global'),
  ('${C.muj}', '${I.muj}', 0, 'můj příběh', 'global'), ('${C.cizi}', '${I.cizi}', 0, 'cizí příběh', 'global');
INSERT INTO public.knowledge_embeddings (chunk_id, knowledge_item_id, embedding, model, model_version, locale,
                                         embedding_v2, model_v2, model_v2_version) VALUES
  ('${C.zivy}', '${I.glob}', ${vek1}, '${MODEL}', '${ID};recipe=chunk_text_v1', 'global', ${vek2}, '${MODEL_V2}', '${ID_V2};recipe=mean'),
  ('${C.stary}', '${I.glob}', ${vek1}, '${MODEL}', '${ID_STARA};recipe=embed_text_v1', 'global', ${vek2}, '${MODEL_V2}', '${ID_V2_STARA};recipe=mean'),
  ('${C.jinyModel}', '${I.glob}', ${vek1}, 'jiny-model-${RUN}', '${ID};recipe=chunk_text_v1', 'global', NULL, NULL, NULL),
  ('${C.bezIdentity}', '${I.glob}', ${vek1}, '${MODEL}', 'vllm-local:space_resolver:v1', 'global', NULL, NULL, NULL),
  ('${C.muj}', '${I.muj}', ${vek1}, '${MODEL}', '${ID};recipe=chunk_text_v1', 'global', NULL, NULL, NULL),
  ('${C.cizi}', '${I.cizi}', ${vek1}, '${MODEL}', '${ID};recipe=chunk_text_v1', 'global', NULL, NULL, NULL);
\\o`;

/** Spustí `telo` po fixture pod danou identitou a vrátí výstup; vše se vrátí (ROLLBACK). */
function vTransakci(telo: string, claims = prihlaseny(VLASTNIK), role = "authenticated", predtim = ""): string {
  return psql(`${FIXTURE}
\\o /dev/null
${predtim}
SET LOCAL request.jwt.claims = '${claims}';
SET LOCAL ROLE ${role};
\\o
${telo};
\\o /dev/null
ROLLBACK`);
}
const jakoVTransakci = (telo: string, claims?: string, role?: string, predtim?: string) => {
  try {
    return { ok: true as const, out: vTransakci(telo, claims, role, predtim) };
  } catch (e) {
    return { ok: false as const, err: String((e as { stderr?: string }).stderr ?? e) };
  }
};

const v3 = (dalsi: string, pref = "v1") =>
  `SELECT string_agg(chunk_id::text, ',' ORDER BY chunk_id) FROM public.mcp_search_knowledge_v3(
     p_query_embedding_v1 => ${pref === "v1" ? vek1 : "NULL"}, p_query_embedding_v2 => ${pref === "v2" ? vek2 : "NULL"},
     p_model_pref => '${pref}', p_limit => 500, p_similarity_threshold => 0.5${dalsi})
   WHERE knowledge_item_id IN ('${I.glob}', '${I.muj}', '${I.cizi}')`;
const mnozina = (out: string) => new Set(out.split(",").filter(Boolean));

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("hledání ve znalostech podle identity vah (P2)", () => {
  it("⭐ s modelem jen vektor DEKLAROVANÉ identity — stará identita, vektor bez identity ani jiný model ne", () => {
    const out = vTransakci(v3(`, p_query_model => '${MODEL}'`));
    expect(mnozina(out)).toEqual(new Set([C.zivy]));
  });

  it("větev v2 (halfvec): totéž pravidlo nad model_v2_version", () => {
    const out = vTransakci(v3(`, p_query_model => '${MODEL_V2}'`, "v2"));
    expect(mnozina(out)).toEqual(new Set([C.zivy]));
  });

  it("přístup k příběhu platí dál: vlastní příběh ano (s identitou), cizí 42501", () => {
    expect(mnozina(vTransakci(v3(`, p_query_model => '${MODEL}', p_story_id => '${PRIBEH}'`)))).toEqual(new Set([C.zivy, C.muj]));
    const cizi = jakoVTransakci(v3(`, p_query_model => '${MODEL}', p_story_id => '${PRIBEH_CIZI}'`));
    expect(cizi.ok).toBe(false);
    if (!cizi.ok) expect(cizi.err).toMatch(/Access denied to story/);
  });

  it("nedeklarovaná identita = jednotná výjimka bez hodnot (ani jméno modelu), ne prázdný výsledek", () => {
    const r = jakoVTransakci(v3(`, p_query_model => '${MODEL_BEZ}'`));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.err).toMatch(/embedding_identity_undeclared/);
      expect(r.err, "zpráva nesmí nést jméno modelu").not.toContain(MODEL_BEZ);
      expect(r.err, "zpráva nesmí nést návod s cestou k deklaraci").not.toMatch(/weights_sha256|weights_format|provider_metadata/);
    }
  });

  it("identitu volající nezadává: v3 parametr s identitou nemá (nelze zkoušet hodnoty deklarace)", () => {
    const r = jakoVTransakci(v3(`, p_query_model => '${MODEL}', p_query_identity => '${ID}'`));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.err).toMatch(/function public\.mcp_search_knowledge_v3\([^)]*\) does not exist|p_query_identity/);
  });

  it("⛔ žádné orákulum: cizí příběh dostane TUTÉŽ odpověď s deklarovaným, nedeklarovaným i žádným modelem", () => {
    const odpovedi = [`'${MODEL}'`, `'${MODEL_BEZ}'`, "NULL", `'neexistuje-${RUN}'`].map((m) => {
      const r = jakoVTransakci(v3(`, p_query_model => ${m}, p_story_id => '${PRIBEH_CIZI}'`));
      expect(r.ok, m).toBe(false);
      // jen první řádek chyby (bez kontextu PL/pgSQL), id příběhu sjednocené
      return r.ok ? "" : (r.err.split("\n").find((l) => l.startsWith("ERROR")) ?? r.err);
    });
    expect(new Set(odpovedi).size, odpovedi.join(" | ")).toBe(1);
    expect(odpovedi[0]).toMatch(/Access denied to story/);
    // Nepřihlášený (bez sub i bez role služby): totéž pro deklarovaný i nedeklarovaný model.
    const anon = [`'${MODEL}'`, `'${MODEL_BEZ}'`].map((m) => {
      const r = jakoVTransakci(v3(`, p_query_model => ${m}`), '{"role":"anon"}', "anon");
      return r.ok ? "ok" : (r.err.split("\n").find((l) => l.startsWith("ERROR")) ?? r.err);
    });
    expect(anon[0]).toBe(anon[1]);
    expect(anon[0]).not.toMatch(/embedding_identity/);
  });

  it("JEDNA definice živého vektoru: co hledání srovná a co dopočet přepočítá, je přesný doplněk", () => {
    const hledani = mnozina(vTransakci(v3(`, p_query_model => '${MODEL}'`)));
    const dopocet = mnozina(vTransakci(
      `SELECT string_agg(chunk_id::text, ',' ORDER BY chunk_id) FROM public.fn_chunks_bez_zive_identity('${MODEL}', '${ID}', 512, 200) WHERE knowledge_item_id = '${I.glob}'`,
      SLUZBA, "service_role",
    ));
    const globalni = new Set([C.zivy, C.stary, C.jinyModel, C.bezIdentity]);
    expect([...hledani].filter((c) => dopocet.has(c)), "vektor nesmí být zároveň živý i k přepočtu").toEqual([]);
    expect(new Set([...hledani, ...dopocet])).toEqual(globalni);
  });

  it("fn_identita_vektoru: identita = část model_version před středníkem; prázdno = NULL", () => {
    const out = psql(`SELECT coalesce(public.fn_identita_vektoru('${ID};recipe=x'), '∅') || '|' ||
                             coalesce(public.fn_identita_vektoru('${ID}'), '∅') || '|' ||
                             coalesce(public.fn_identita_vektoru(NULL), '∅') || '|' ||
                             coalesce(public.fn_identita_vektoru(''), '∅') || '|' ||
                             coalesce(public.fn_identita_vektoru('vllm-local:space_resolver:v1'), '∅')`);
    expect(out).toBe(`${ID}|${ID}|∅|∅|vllm-local:space_resolver:v1`);
  });

  it("pomocník deklarace: EXECUTE jen služba (i na forku s výchozím EXECUTE pro authenticated); v3 pod přihlášeným dál funguje", () => {
    const sot = (jmeno: string) => join(process.cwd(), "aisha/db/sql/functions", `${jmeno}.sql`);
    const kotva = `zz_kotva_idv_${RUN}`;
    const out = psql(`\\o /dev/null
BEGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
DROP FUNCTION public.fn_deklarace_vah_embeddingu(text);
\\i ${sot("fn_deklarace_vah_embeddingu")}
CREATE FUNCTION public.${kotva}() RETURNS integer LANGUAGE sql AS 'SELECT 1';
REVOKE ALL ON FUNCTION public.${kotva}() FROM PUBLIC;
\\o
SELECT p.proname || '|' || has_function_privilege('anon', p.oid, 'EXECUTE') || '|'
       || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|'
       || has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_deklarace_vah_embeddingu', '${kotva}')
 ORDER BY p.proname;
\\o /dev/null
ROLLBACK`);
    const radky = Object.fromEntries(out.split("\n").filter(Boolean).map((r) => [r.split("|")[0], r.split("|").slice(1)]));
    expect(radky[kotva]?.slice(0, 2), "simulace forku nedala authenticated EXECUTE — test by nic neměřil").toEqual(["true", "true"]);
    expect(radky.fn_deklarace_vah_embeddingu).toEqual(["false", "false", "true"]);
    // Přímo pod přihlášeným nejde; v3 (definer) ji použije a funguje.
    const primo = jakoVTransakci(`SELECT identita FROM public.fn_deklarace_vah_embeddingu('${MODEL}')`);
    expect(primo.ok).toBe(false);
    expect(mnozina(vTransakci(v3(`, p_query_model => '${MODEL}'`)))).toEqual(new Set([C.zivy]));
  });

  it("KOTVA měřidla: v3 BEZ filtru identity (mutace v transakci) starý vektor vrátí — test vadu vidí", () => {
    const zdroj = readFileSync(join(process.cwd(), "aisha/db/sql/functions/mcp_search_knowledge_v3.sql"), "utf-8");
    const mutant = zdroj
      .replace("AND (p_query_model IS NULL OR public.fn_identita_vektoru(ke.model_version) = v_identita)", "")
      .replace("AND (p_query_model IS NULL OR public.fn_identita_vektoru(ke.model_v2_version) = v_identita)", "");
    expect(mutant, "mutace se nepovedla — filtr v SoT nenalezen").not.toBe(zdroj);
    const adresar = mkdtempSync(join(tmpdir(), "idv-mutant-"));
    try {
      const soubor = join(adresar, "v3-mutant.sql");
      writeFileSync(soubor, mutant);
      const out = vTransakci(v3(`, p_query_model => '${MODEL}'`), prihlaseny(VLASTNIK), "authenticated", `RESET ROLE;\n\\i ${soubor}`);
      expect(mnozina(out)).toEqual(new Set([C.zivy, C.stary, C.bezIdentity]));
    } finally {
      rmSync(adresar, { recursive: true, force: true });
    }
  });

  it("granty v3 (podpis beze změny, 15 argumentů): anon nic, authenticated a služba ano; 16argumentový neexistuje", () => {
    const sig = "public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid)";
    const out = jako(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') || '|' || has_function_privilege('authenticated', '${sig}', 'EXECUTE') || '|' || has_function_privilege('service_role', '${sig}', 'EXECUTE')`);
    expect(out).toEqual({ ok: true, out: "false|true|true" });
    const s16 = jako(`SELECT to_regprocedure('public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid,text)') IS NULL`);
    expect(s16).toEqual({ ok: true, out: "t" });
  });
});
