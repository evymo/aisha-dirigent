/**
 * Gate test: RAG model-identity guard (Brick2).
 *
 * Brick2 makes the embedding MODEL a first-class correctness axis of retrieval —
 * a query embedded by model X may only be cosine-compared against chunks embedded
 * by model X (model-as-index-constant). This gate locks the three SoT pieces that
 * enforce it, against the committed source files:
 *
 *   - mcp_search_knowledge_v3 gains `p_query_model text` (13th arg) and applies it
 *     as a HARD WHERE on ke.model / ke.model_v2 (a CORRECTNESS filter, NOT a score
 *     or ORDER BY term). NULL ⇒ no filter (back-compat). The added trailing arg is
 *     a signature change, so the old 12-arg overload is DROPped before the CREATE.
 *   - knowledge_embeddings carries model_registry_id / model_v2_registry_id FK cols
 *     → ai_model_registry(id) with NO ON DELETE CASCADE (deprecating a model must
 *     never cascade-delete the corpus it embedded).
 *   - the embedding writers resolve model_registry_id from p_model and RAISE 23503
 *     on an unregistered model (fail-loud; never a silent NULL pin).
 *   - fn_resolve_embedding_model_for_space exists and dim-routes (2560 ⇒ v2, else
 *     v1), gated on enabled+healthy provider serving an available embedding model.
 *   - the regenerated baseline carries all of the above.
 *   - P2 (2026-10-06): jméno modelu NESTAČÍ — v3 srovnává dotaz jen s vektory, jejichž identita
 *     vah (fn_identita_vektoru(model_version)) = DEKLAROVANÁ identita modelu
 *     (fn_deklarace_vah_embeddingu, týž domov jako dopočet v1); nedeklarovaná identita je výjimka,
 *     ne prázdný výsledek. Identitu volající nezadává (revize 2026-10-07: orákulum); identitu,
 *     kterou ohlásila lane, ověří služba před voláním (overIdentituDotazu).
 *
 * Runtime proof of the behavior (resolver dim-routing, cross-model reject, writer
 * fail-loud + PIN, FK no-cascade) lives in the pgTAP suite
 * aisha/db/tests/schema/04_model_guard.sql (cold-start gate).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const p = (rel: string) => path.join(ROOT, rel);
const read = (rel: string): string => {
  const fp = p(rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const V3 = read('aisha/db/sql/functions/mcp_search_knowledge_v3.sql');
const EMB = read('aisha/db/sql/tables/knowledge_embeddings.sql');
const INS_EMB = read('aisha/db/sql/functions/insert_knowledge_embedding.sql');
const INS_EMB_V2 = read('aisha/db/sql/functions/insert_knowledge_embedding_v2_audited.sql');
const RESOLVE = read('aisha/db/sql/functions/fn_resolve_embedding_model_for_space.sql');
const BASELINE = read('aisha/db/migrations/00000000000000_baseline.sql');

/**
 * Rozměr v1 prostoru ze SoT — brána nesmí držet číslo, které schéma nemá.
 * Byl 1536 (tvar po OpenAI), je 1024 (model, kterým instance embeduje lokálně).
 * Kdyby tu stálo natvrdo, po změně schématu by brána hlídala neexistující stav.
 */
const V1_DIM = (() => {
  const src = read('aisha/db/sql/tables/knowledge_embeddings.sql');
  const m = src.match(/\bembedding\s+vector\((\d+)\)/);
  if (!m) throw new Error('rozměr v1 se ze SoT nepodařilo přečíst — brána ztratila vstup');
  return Number(m[1]);
})();
const PGTAP = read('aisha/db/tests/schema/04_model_guard.sql');
const DEKLARACE = read('aisha/db/sql/functions/fn_deklarace_vah_embeddingu.sql');
const IDENTITA_VEKTORU = read('aisha/db/sql/functions/fn_identita_vektoru.sql');
const ZIVA = read('aisha/db/sql/functions/fn_ziva_identita_v1.sql');
const BEZ_ZIVE = read('aisha/db/sql/functions/fn_chunks_bez_zive_identity.sql');
const HEALS = read('aisha/db/heals.sql');
/** Podpis v3 (Brick6, 15 argumentů) — P2 ho NEMĚNÍ: identitu filtru počítá server, volající ji nezadává. */
const V3_SIG = 'mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid)';
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('Brick2 guard — mcp_search_knowledge_v3 has the HARD p_query_model WHERE', () => {
  it('declares p_query_model text DEFAULT NULL as the 13th arg', () => {
    expect(V3.length, 'v3 SoT must exist').toBeGreaterThan(0);
    expect(V3).toMatch(/p_query_model text DEFAULT NULL/i);
  });

  it('applies the HARD model-identity WHERE on both arms (v1 + v2)', () => {
    // v1 arm: NULL ⇒ no filter, else ke.model = p_query_model.
    expect(V3).toMatch(/\(p_query_model IS NULL OR ke\.model = p_query_model\)/);
    // v2 arm: NULL ⇒ no filter, else ke.model_v2 = p_query_model.
    expect(V3).toMatch(/\(p_query_model IS NULL OR ke\.model_v2 = p_query_model\)/);
  });

  it('the filter is a WHERE term, NOT in ORDER BY / not multiplied into the score', () => {
    // No ORDER BY *line* may reference p_query_model (line-anchored).
    const orderByLines = (V3.match(/^\s*ORDER BY .*$/gm) ?? []).join('\n');
    expect(orderByLines, 'p_query_model must not appear in ORDER BY').not.toMatch(/p_query_model/);
    // Brick5 reranks on s_eff_dist (cosine distance − a locale boost). The model guard is
    // still a pure WHERE term — s_eff_dist and the ORDER BY never reference p_query_model.
    expect(V3).toMatch(/ORDER BY s\.s_eff_dist ASC/);
    expect(V3).toMatch(/AS s_eff_dist/);
    // The model column is never multiplied into a similarity score expression.
    expect(V3, 'model identity must not be a score term').not.toMatch(
      /ke\.model(_v2)?[\s\S]{0,20}\*\s*\d/,
    );
  });

  it('DROPs the prior overloads BEFORE CREATE; GRANTs at the Brick6 15-arg arity', () => {
    const dropIdx = V3.search(
      /DROP FUNCTION IF EXISTS public\.mcp_search_knowledge_v3\(vector,halfvec,text,text\[\],text,text,text\[\],boolean,integer,numeric,uuid,text\)/,
    );
    const createIdx = V3.search(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v3/);
    expect(dropIdx, 'v3 must DROP the old 12-arg overload').toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
    // Brick6 also DROPs the 14-arg overload (p_audience_user_id changed the signature to 15 args).
    expect(V3).toMatch(
      /DROP FUNCTION IF EXISTS public\.mcp_search_knowledge_v3\(vector,halfvec,text,text\[\],text,text,text\[\],boolean,integer,numeric,uuid,text,text,text\)/,
    );
    // The current 15-arg signature is NOT dropped (CREATE OR REPLACE replaces it in place).
    expect(V3).not.toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${esc(V3_SIG)}`));
    // The re-issued REVOKE/GRANT are at the 15-arg arity (…uuid,text,text,text,uuid).
    for (const komu of ['authenticated', 'service_role']) {
      expect(V3).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${esc(V3_SIG)} TO ${komu}`));
    }
    expect(V3).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${esc(V3_SIG)} FROM PUBLIC`));
  });
});

describe('P2 guard — v3 filtruje podle IDENTITY VAH, ne jen podle jména modelu', () => {
  it('⛔ identitu volající NEZADÁVÁ (revize 2026-10-07: parametr s identitou = orákulum deklarace)', () => {
    expect(V3.replace(/^--.*$/gm, ''), 'v3 nesmí přijímat identitu vah od volajícího').not.toMatch(/p_query_identity/);
    expect(V3).toMatch(/p_audience_user_id uuid DEFAULT NULL::uuid\)\s+RETURNS TABLE/);
  });

  it('⛔ pořadí: přihlášení a přístup k příběhu PŘED čtením deklarace (cizí volající nic nevyčte)', () => {
    const telo = V3.slice(V3.indexOf('$function$'));
    const pristup = telo.indexOf("RAISE EXCEPTION 'Access denied to story %'");
    const publikum = telo.indexOf('v_story_ok :=');
    const deklarace = telo.indexOf('fn_deklarace_vah_embeddingu(p_query_model)');
    expect(pristup, 'kontrola příběhu nenalezena — měřidlo slepé').toBeGreaterThan(-1);
    expect(deklarace).toBeGreaterThan(pristup);
    expect(deklarace).toBeGreaterThan(publikum);
  });

  it('deklarovanou identitu čte JEDINÝ domov (fn_deklarace_vah_embeddingu) — v3 i dopočet v1', () => {
    expect(V3).toMatch(/FROM public\.fn_deklarace_vah_embeddingu\(p_query_model\)/);
    expect(ZIVA).toMatch(/FROM public\.fn_deklarace_vah_embeddingu\(v_model\)/);
    // Žádná další funkce si deklaraci neskládá sama (čtení declared.weights_sha256 jen v domově).
    expect(V3).not.toMatch(/weights_sha256/);
    expect(ZIVA.replace(/^--.*$/gm, '')).not.toMatch(/'weights_sha256'/);
    expect(DEKLARACE).toMatch(/provider_metadata->'declared'->>'weights_sha256'/);
  });

  it('tvrdý WHERE identity vektoru v OBOU větvích (v1 model_version, v2 model_v2_version)', () => {
    expect(V3).toMatch(/\(p_query_model IS NULL OR public\.fn_identita_vektoru\(ke\.model_version\) = v_identita\)/);
    expect(V3).toMatch(/\(p_query_model IS NULL OR public\.fn_identita_vektoru\(ke\.model_v2_version\) = v_identita\)/);
    // Identita není člen skóre ani řazení.
    const orderBy = (V3.match(/^\s*ORDER BY .*$/gm) ?? []).join('\n');
    expect(orderBy).not.toMatch(/identit/);
  });

  it('dopočet i hledání rozumí „živému vektoru“ stejně (fn_identita_vektoru, jeden domov)', () => {
    expect(BEZ_ZIVE).toMatch(/public\.fn_identita_vektoru\(e\.model_version\) = p_identita/);
    expect(BEZ_ZIVE).not.toMatch(/split_part\(/);
    expect(IDENTITA_VEKTORU).toMatch(/split_part\(coalesce\(p_model_version, ''\), ';', 1\)/);
    // IMMUTABLE sql bez SET — jinak by ji plánovač nevložil a volal by ji pro každý vektor korpusu.
    expect(IDENTITA_VEKTORU).toMatch(/LANGUAGE sql\s+IMMUTABLE/);
    expect(IDENTITA_VEKTORU.replace(/^--.*$/gm, '')).not.toMatch(/\bSET\s+search_path/i);
  });

  it('nedeklarovaná identita je VÝJIMKA; volajícímu v3 JEDNOTNÁ zpráva bez hodnot', () => {
    expect(DEKLARACE).toMatch(/embedding_identity_undeclared[\s\S]{0,400}USING ERRCODE = '22023'/);
    // v3 čte deklaraci před větvením a podrobnou zprávu domova (jméno modelu, návod) nahradí jednotnou.
    expect(V3).toMatch(
      /IF p_query_model IS NOT NULL THEN\s+BEGIN\s+SELECT d\.identita INTO v_identita FROM public\.fn_deklarace_vah_embeddingu\(p_query_model\) d;\s+EXCEPTION WHEN invalid_parameter_value THEN\s+RAISE EXCEPTION 'vektorové hledání nedostupné \(embedding_identity_undeclared\)'\s+USING ERRCODE = '22023';/,
    );
    // Žádná zpráva v těle v3 nevypisuje deklaraci ani identitu.
    const zpravy = [...V3.matchAll(/RAISE EXCEPTION '([^']*)'(,[^;]*)?/g)];
    expect(zpravy.length).toBeGreaterThan(0);
    for (const [, , argumenty] of zpravy) expect(argumenty ?? '').not.toMatch(/identita|p_query_model/);
    // Deklarace se NEDOSAZUJE (žádný výchozí formát ani pin).
    expect(DEKLARACE).not.toMatch(/coalesce\([^)]*weights_format[^)]*'gguf'/i);
  });

  it('pomocník deklarace: EXECUTE jen služba (ani authenticated na forku s výchozím EXECUTE)', () => {
    expect(DEKLARACE).toMatch(/REVOKE ALL ON FUNCTION public\.fn_deklarace_vah_embeddingu\(text\) FROM PUBLIC, anon, authenticated;/);
    expect(DEKLARACE).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_deklarace_vah_embeddingu\(text\) TO service_role;/);
    expect(DEKLARACE.replace(/^--.*$/gm, '')).not.toMatch(/SECURITY DEFINER/);
  });

  it('heals.sql zapojuje pomocníky PŘED funkcemi, které je volají (dotečení na běžící DB)', () => {
    const blok = HEALS.slice(HEALS.indexOf('P2 HLEDÁNÍ PODLE IDENTITY VAH'));
    const i = (rel: string) => blok.indexOf(`\\ir sql/functions/${rel}.sql`);
    for (const f of ['fn_identita_vektoru', 'fn_deklarace_vah_embeddingu', 'fn_ziva_identita_v1', 'fn_chunks_bez_zive_identity', 'mcp_search_knowledge_v3']) {
      expect(i(f), `${f} chybí v bloku P2 v heals.sql`).toBeGreaterThan(-1);
    }
    expect(i('fn_deklarace_vah_embeddingu')).toBeLessThan(i('fn_ziva_identita_v1'));
    expect(i('fn_identita_vektoru')).toBeLessThan(i('fn_chunks_bez_zive_identity'));
    expect(i('fn_deklarace_vah_embeddingu')).toBeLessThan(i('mcp_search_knowledge_v3'));
  });
});

describe('P2 guard — produkční volající v3 předávají model i identitu; žádná tichá textová záloha', () => {
  /** Zdrojáky služeb (bez testů), které volají mcp_search_knowledge_v3. */
  const volajici = (() => {
    const out: Array<{ soubor: string; src: string }> = [];
    const projdi = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (['node_modules', 'dist', 'tests', '__tests__'].includes(e.name)) continue;
          projdi(full);
        } else if (/\.(ts|mts|js|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) {
          const src = fs.readFileSync(full, 'utf8');
          if (src.includes("'mcp_search_knowledge_v3'")) out.push({ soubor: path.relative(ROOT, full), src });
        }
      }
    };
    projdi(p('services'));
    return out;
  })();

  /** Objekt argumentů každého volání v3 (od jména RPC po uzavírací `}`). */
  const argumentyVolani = (src: string): string[] =>
    [...src.matchAll(/'mcp_search_knowledge_v3',\s*\{/g)].map((m) => {
      let hloubka = 0;
      const start = (m.index ?? 0) + m[0].length - 1;
      for (let k = start; k < src.length; k++) {
        if (src[k] === '{') hloubka++;
        else if (src[k] === '}' && --hloubka === 0) return src.slice(start, k + 1);
      }
      return src.slice(start);
    });

  /** Těla `catch` bloků (vyvážené závorky). */
  const telaCatch = (src: string): string[] =>
    [...src.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)].map((m) => {
      let hloubka = 0;
      const start = (m.index ?? 0) + m[0].length - 1;
      for (let k = start; k < src.length; k++) {
        if (src[k] === '{') hloubka++;
        else if (src[k] === '}' && --hloubka === 0) return src.slice(start, k + 1);
      }
      return src.slice(start);
    });

  it('sonda má co měřit: volající v3 existují (prod hledání i eval)', () => {
    expect(volajici.map((v) => v.soubor)).toContain('services/svc-mcp-knowledge/src/routes/mcp.ts');
    expect(volajici.length).toBeGreaterThanOrEqual(2);
  });

  it('každé volání v3 nese p_query_model; identitu z lane služba ověří PŘED voláním (overIdentituDotazu)', () => {
    const vady: string[] = [];
    for (const v of volajici) {
      const prvniVolani = v.src.indexOf("'mcp_search_knowledge_v3'");
      const overeni = v.src.indexOf('overIdentituDotazu(');
      if (overeni < 0 || overeni > prvniVolani) vady.push(`${v.soubor}: identita dotazu se neověří před voláním v3`);
      for (const a of argumentyVolani(v.src)) {
        if (!/\bp_query_model\s*:/.test(a)) vady.push(`${v.soubor}: volání v3 bez p_query_model`);
        if (/\bp_query_identity\s*:/.test(a)) vady.push(`${v.soubor}: volání v3 nese identitu od volajícího`);
      }
    }
    expect(vady).toEqual([]);
  });

  it('žádný catch u vektorového hledání nepřechází na textové hledání (selhat nahlas, ne tichá záloha)', () => {
    const vady: string[] = [];
    for (const v of volajici) {
      for (const telo of telaCatch(v.src)) {
        if (/mcp_search_knowledge_v2|'mcp_search_knowledge'/.test(telo)) vady.push(`${v.soubor}: catch volá textové hledání`);
      }
    }
    expect(vady).toEqual([]);
  });

  it('kotva měřidla: catch s textovou zálohou i volání bez modelu jsou nález', () => {
    const vzor = `rpc('mcp_search_knowledge_v3', { p_query_model: m, p_query_text: q });
      try { x(); } catch { return rpc('mcp_search_knowledge_v2', { p_query_text: q }); }`;
    expect(telaCatch(vzor).some((t) => /mcp_search_knowledge_v2/.test(t))).toBe(true);
    expect(argumentyVolani(vzor).every((a) => /\bp_query_model\s*:/.test(a))).toBe(true);
    expect(argumentyVolani(`rpc('mcp_search_knowledge_v3', { p_query_text: q })`).every((a) => /\bp_query_model\s*:/.test(a))).toBe(false);
  });
});

describe('Brick2 guard — knowledge_embeddings model_registry FK has NO cascade', () => {
  it('carries both *_registry_id FK cols → ai_model_registry(id)', () => {
    expect(EMB.length, 'knowledge_embeddings SoT must exist').toBeGreaterThan(0);
    expect(EMB).toMatch(
      /model_registry_id uuid REFERENCES public\.ai_model_registry\(id\)/,
    );
    expect(EMB).toMatch(
      /model_v2_registry_id uuid REFERENCES public\.ai_model_registry\(id\)/,
    );
  });

  it('neither FK col is ON DELETE CASCADE (deprecating a model must not nuke the corpus)', () => {
    // Isolate each column-definition line and assert it carries no cascade.
    const regLine = EMB.split('\n').find((l) => /^\s*model_registry_id uuid REFERENCES/.test(l)) ?? '';
    const regV2Line =
      EMB.split('\n').find((l) => /^\s*model_v2_registry_id uuid REFERENCES/.test(l)) ?? '';
    expect(regLine, 'model_registry_id FK must NOT cascade').not.toMatch(/ON DELETE CASCADE/i);
    expect(regV2Line, 'model_v2_registry_id FK must NOT cascade').not.toMatch(/ON DELETE CASCADE/i);
    // The cols are nullable (legacy rows + deferred backfill) — no NOT NULL on them.
    expect(regLine).not.toMatch(/NOT NULL/i);
  });
});

describe('Brick2 guard — embedding writers PIN the registry id and fail loud', () => {
  it('insert_knowledge_embedding resolves model_registry_id from p_model + RAISEs 23503 on unregistered', () => {
    expect(INS_EMB.length, 'insert_knowledge_embedding SoT must exist').toBeGreaterThan(0);
    // Resolve the canonical registry row for the named model.
    expect(INS_EMB).toMatch(/FROM public\.ai_model_registry\s+WHERE model_id = p_model AND is_embedding/);
    // Fail loud on an unregistered model (no silent NULL pin).
    expect(INS_EMB).toMatch(/IF v_model_registry_id IS NULL THEN/);
    expect(INS_EMB).toMatch(/RAISE EXCEPTION[\s\S]{0,160}USING ERRCODE = '23503'/);
    // The resolved id is written onto the row.
    expect(INS_EMB).toMatch(/model_registry_id/);
  });

  it('insert_knowledge_embedding_v2_audited resolves model_v2_registry_id + RAISEs 23503 on unregistered', () => {
    expect(INS_EMB_V2.length, 'v2 writer SoT must exist').toBeGreaterThan(0);
    expect(INS_EMB_V2).toMatch(/FROM public\.ai_model_registry\s+WHERE model_id = p_model AND is_embedding/);
    expect(INS_EMB_V2).toMatch(/IF v_model_v2_registry_id IS NULL THEN/);
    expect(INS_EMB_V2).toMatch(/RAISE EXCEPTION[\s\S]{0,160}USING ERRCODE = '23503'/);
    expect(INS_EMB_V2).toMatch(/model_v2_registry_id = v_model_v2_registry_id/);
  });
});

describe('Brick2 PIN — fn_resolve_embedding_model_for_space dim-routes to the corpus space', () => {
  it('exists with the (p_rag_space, p_context_profile_slug) signature', () => {
    expect(RESOLVE.length, 'resolver SoT must exist').toBeGreaterThan(0);
    expect(RESOLVE).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_resolve_embedding_model_for_space\(p_rag_space text DEFAULT 'v1'::text, p_context_profile_slug text DEFAULT NULL::text\)/,
    );
  });

  it('dim-routes na korpusový prostor a gates on availability + provider health', () => {
    // VLASTNOST, ne pravopis: resolver musí mapovat rozměr na prostor pro OBA
    // prostory. Dřív tu byl pin na doslovné znění
    // `CASE WHEN dim = 2560 THEN 'v2' ELSE 'v1' END` — jenže to nebyla derivace:
    // `ELSE 'v1'` prohlásilo KAŽDÝ jiný rozměr za v1, takže model s 1024 dostal
    // nálepku prostoru, do kterého se nevejde. Pin na text navíc bránil opravu.
    // Rozměr v1 se čte ze SoT, aby brána nedržela číslo, které schéma nemá.
    expect(RESOLVE).toMatch(/WHEN\s+2560\s+THEN\s+'v2'/);
    expect(RESOLVE).toMatch(new RegExp(`WHEN\\s+${V1_DIM}\\s+THEN\\s+'v1'`));
    // Capability-availability gating (no allow-list): the model + its provider.
    expect(RESOLVE).toMatch(/r\.is_embedding/);
    expect(RESOLVE).toMatch(/r\.is_available/);
    expect(RESOLVE).toMatch(/NOT r\.is_deprecated/);
    expect(RESOLVE).toMatch(/p\.is_enabled/);
    expect(RESOLVE).toMatch(/p\.last_health_status IN \('healthy', 'unknown'\)/);
  });

  it("reads the context profile's pinned embedding space DB-side (RPC-only data access)", () => {
    expect(RESOLVE).toMatch(/SELECT cp\.embedding_model_pref INTO v_space/);
    expect(RESOLVE).toMatch(/FROM public\.context_profiles cp/);
  });

  it('only service_role may execute it', () => {
    expect(RESOLVE).toMatch(
      /GRANT EXECUTE ON FUNCTION fn_resolve_embedding_model_for_space\(text, text\) TO service_role/,
    );
  });
});

describe('Brick2 guard — regenerated baseline carries the guard/PIN', () => {
  it('baseline has the 13-arg v3 with p_query_model and the 12-arg DROP', () => {
    expect(BASELINE.length, 'baseline must exist').toBeGreaterThan(0);
    expect(BASELINE).toMatch(/p_query_model text/);
    expect(BASELINE).toMatch(/\(p_query_model IS NULL OR ke\.model = p_query_model\)/);
    expect(BASELINE).toMatch(/\(p_query_model IS NULL OR ke\.model_v2 = p_query_model\)/);
    expect(BASELINE).toMatch(
      /DROP FUNCTION IF EXISTS public\.mcp_search_knowledge_v3\(vector,halfvec,text,text\[\],text,text,text\[\],boolean,integer,numeric,uuid,text\)/,
    );
  });

  it('baseline has the knowledge_embeddings registry FK cols WITHOUT cascade', () => {
    // Match the two FK col definitions in the knowledge_embeddings CREATE.
    expect(BASELINE).toMatch(/model_registry_id uuid REFERENCES public\.ai_model_registry\(id\),/);
    expect(BASELINE).toMatch(/model_v2_registry_id uuid REFERENCES public\.ai_model_registry\(id\),/);
    // Neither of those exact (comma-terminated, no-cascade) col defs may carry a cascade —
    // assert the no-cascade form is present (the with-cascade form on OTHER tables is fine).
    const embFkNoCascade = /model_registry_id uuid REFERENCES public\.ai_model_registry\(id\),\n\s*model_v2_registry_id uuid REFERENCES public\.ai_model_registry\(id\),/;
    expect(BASELINE).toMatch(embFkNoCascade);
  });

  it('baseline carries the space resolver + the writer 23503 fail-loud', () => {
    expect(BASELINE).toMatch(/fn_resolve_embedding_model_for_space/);
    expect(BASELINE).toMatch(/WHEN\s+2560\s+THEN\s+'v2'/);
    expect(BASELINE).toMatch(new RegExp(`WHEN\\s+${V1_DIM}\\s+THEN\\s+'v1'`));
    expect(BASELINE).toMatch(/is not a registered is_embedding model in ai_model_registry/);
  });
});

describe('Brick2 guard — pgTAP runtime proof exists', () => {
  it('04_model_guard.sql asserts resolver/cross-model-reject/writer-pin/no-cascade', () => {
    expect(PGTAP.length, 'pgTAP suite must exist').toBeGreaterThan(0);
    // resolver dim-routing for both spaces.
    expect(PGTAP).toMatch(/fn_resolve_embedding_model_for_space\('v2'\)/);
    expect(PGTAP).toMatch(/fn_resolve_embedding_model_for_space\('v1'\)/);
    // cross-model reject + back-compat NULL through v3's p_query_model.
    expect(PGTAP).toMatch(/p_query_model := 'mg-embed-2560'/);
    expect(PGTAP).toMatch(/p_query_model := NULL/);
    // writer fail-loud (23503) + FK no-cascade (23503).
    expect(PGTAP).toMatch(/throws_ok[\s\S]{0,400}'23503'/);
    // P2: identita vah — stará identita téhož jména se nemíchá, nedeklarovaná = jednotná výjimka,
    // cizí volající dostane 42501 dřív, než se deklarace vůbec čte.
    expect(PGTAP).toMatch(/throws_like[\s\S]{0,400}'%embedding_identity_undeclared%'/);
    expect(PGTAP).toMatch(/'vektorové hledání nedostupné \(embedding_identity_undeclared\)'/);
    expect(PGTAP).toMatch(/\(m\) cizí uživatel: přístup k příběhu se měří PŘED deklarací/);
    expect(PGTAP).toMatch(/\(j\) v3 s modelem vrací JEN vektor deklarované identity/);
    // the plan count is declared (kept in lock-step with the assertion count).
    expect(PGTAP).toMatch(/SELECT plan\(13\)/);
  });
});
