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
    // The re-issued REVOKE/GRANT are at the new 15-arg arity (…uuid,text,text,text,uuid).
    expect(V3).toMatch(
      /GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v3\(vector,halfvec,text,text\[\],text,text,text\[\],boolean,integer,numeric,uuid,text,text,text,uuid\) TO service_role/,
    );
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
    // the plan count is declared (kept in lock-step with the assertion count).
    expect(PGTAP).toMatch(/SELECT plan\(9\)/);
  });
});
