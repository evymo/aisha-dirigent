/**
 * Gate test: RAG locale foundation (Brick3).
 *
 * Adds a `locale` axis to the knowledge layer that is BEHAVIOR-NEUTRAL today:
 * every row defaults to the 'global' sentinel, and NO retrieval WHERE filter or
 * score term references locale. This gate locks the schema foundation that the
 * later cross-lingual bricks depend on, and — crucially — locks the invariants
 * that keep it neutral and safe:
 *
 *   - locale is `NOT NULL DEFAULT 'global'` on knowledge_items / _chunks /
 *     _embeddings (so every legacy + new row is FK-valid against the sentinel).
 *   - the locale FK uses default NO ACTION (NO ON DELETE CASCADE) — removing a
 *     language must never cascade-delete the knowledge corpus.
 *   - the per-chunk / per-embedding uniques are widened to include locale so the
 *     same source chunk can coexist across locales.
 *   - the 'global' sentinel is seeded (seed source + compiled seed) and converged
 *     by db_self_repair, and the regenerated baseline carries the columns/FKs.
 *   - the touched reader/writer fns surface locale only, and every signature /
 *     return-shape change DROPs its old overload before CREATE (no PGRST203).
 *
 * Runtime proof of the behavior (default → 'global', locale='zz' → 23503, cross-
 * locale coexistence, no-cascade) lives in the pgTAP suite
 * aisha/db/tests/schema/03_locale_foundation.sql (cold-start gate).
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

const ITEMS = read('aisha/db/sql/tables/knowledge_items.sql');
const CHUNKS = read('aisha/db/sql/tables/knowledge_chunks.sql');
const EMB = read('aisha/db/sql/tables/knowledge_embeddings.sql');
const FK_ITEMS = read('aisha/db/sql/constraints/fk_knowledge_items_locale.sql');
const FK_CHUNKS = read('aisha/db/sql/constraints/fk_knowledge_chunks_locale.sql');
const FK_EMB = read('aisha/db/sql/constraints/fk_knowledge_embeddings_locale.sql');
const UNIQ_CHUNKS = read(
  'aisha/db/sql/indexes/knowledge_chunks_knowledge_item_id_chunk_index_key.sql',
);
const UNIQ_EMB = read('aisha/db/sql/indexes/knowledge_embeddings_chunk_id_key.sql');
const SEED_SRC = read('aisha/db/seed/core/02_languages.sql');
const SEED_COMPILED = read('aisha/db/seed.compiled.sql');
const SELF_REPAIR = read('aisha/db/sql/functions/db_self_repair.sql');
const BASELINE = read('aisha/db/migrations/00000000000000_baseline.sql');
const PGTAP = read('aisha/db/tests/schema/03_locale_foundation.sql');

const V2 = read('aisha/db/sql/functions/mcp_search_knowledge_v2.sql');
const V3 = read('aisha/db/sql/functions/mcp_search_knowledge_v3.sql');
const INS_CHUNK = read('aisha/db/sql/functions/insert_knowledge_chunk.sql');
const INS_EMB = read('aisha/db/sql/functions/insert_knowledge_embedding.sql');
const INS_EMB_V2 = read('aisha/db/sql/functions/insert_knowledge_embedding_v2_audited.sql');
const GET_CHUNKS = read('aisha/db/sql/functions/fn_get_chunks_needing_context.sql');
const GET_EMB_V2 = read('aisha/db/sql/functions/fn_get_embeddings_needing_v2.sql');
const UPSERT = read('aisha/db/sql/functions/upsert_story_knowledge_item_audited.sql');
const TS_ROUTE = read('services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts');

const LOCALE_COL = /locale\s+text\s+NOT NULL\s+DEFAULT\s+'global'/i;

describe('Brick3 locale — columns are NOT NULL DEFAULT global on the 3 tables', () => {
  it('knowledge_items carries the locale column (back-port ALTER)', () => {
    expect(ITEMS).toMatch(
      /ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'global'/i,
    );
    // source_hash is added alongside (nullable, no default).
    expect(ITEMS).toMatch(/ADD COLUMN IF NOT EXISTS source_hash text/i);
  });

  it('knowledge_chunks carries the locale column in the CREATE list', () => {
    expect(CHUNKS).toMatch(LOCALE_COL);
    expect(CHUNKS).toMatch(/source_hash\s+text/i);
  });

  it('knowledge_embeddings carries the locale column (no source_hash COLUMN here)', () => {
    expect(EMB).toMatch(LOCALE_COL);
    // The denormalized embeddings table gets locale but NOT source_hash (that lives
    // on chunks/items). Assert no source_hash COLUMN definition (a comment mentioning
    // it is fine — match the column form `source_hash <type>`).
    expect(EMB).not.toMatch(/^\s*source_hash\s+\w/im);
  });
});

describe('Brick3 locale — FK has NO ON DELETE CASCADE (default NO ACTION)', () => {
  for (const [name, sql, table] of [
    ['items', FK_ITEMS, 'knowledge_items'],
    ['chunks', FK_CHUNKS, 'knowledge_chunks'],
    ['embeddings', FK_EMB, 'knowledge_embeddings'],
  ] as const) {
    it(`${name} FK references supported_languages(code) and does NOT cascade`, () => {
      expect(sql.length, `${name} FK SoT must exist`).toBeGreaterThan(0);
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}`),
      );
      expect(sql).toMatch(/FOREIGN KEY \(locale\)/i);
      expect(sql).toMatch(/REFERENCES public\.supported_languages\(code\)/i);
      // The load-bearing invariant: removing a language must not nuke the corpus.
      expect(sql, `${name} locale FK must NOT be ON DELETE CASCADE`).not.toMatch(
        /ON DELETE CASCADE/i,
      );
      // Idempotent guard (re-appliable on existing DBs).
      expect(sql).toMatch(/pg_constraint/i);
    });
  }
});

describe('Brick3 locale — widened uniques include locale', () => {
  it('knowledge_chunks unique = (knowledge_item_id, chunk_index, locale)', () => {
    expect(UNIQ_CHUNKS).toMatch(
      /UNIQUE INDEX knowledge_chunks_knowledge_item_id_chunk_index_key[\s\S]*\(knowledge_item_id,\s*chunk_index,\s*locale\)/,
    );
  });
  it('knowledge_embeddings unique = (chunk_id, locale)', () => {
    expect(UNIQ_EMB).toMatch(
      /UNIQUE INDEX knowledge_embeddings_chunk_id_key[\s\S]*\(chunk_id,\s*locale\)/,
    );
  });
});

describe("Brick3 locale — 'global' sentinel is seeded + self-healed + baselined", () => {
  const SENTINEL = /\('global',\s*'Global',\s*'languages\.global\.name',\s*true,\s*false,\s*0\)/;

  it('seed source (02_languages.sql) seeds the global sentinel first', () => {
    expect(SEED_SRC).toMatch(SENTINEL);
  });
  it('compiled seed carries the global sentinel', () => {
    expect(SEED_COMPILED).toMatch(SENTINEL);
  });
  it('db_self_repair converges the global sentinel for existing DBs', () => {
    expect(SELF_REPAIR).toMatch(/code = 'global'/);
    expect(SELF_REPAIR).toMatch(
      /INSERT INTO public\.supported_languages[\s\S]{0,200}'global'[\s\S]{0,80}'Global'/,
    );
  });
  it('regenerated baseline carries the locale columns + the no-cascade FK', () => {
    expect(BASELINE.length).toBeGreaterThan(0);
    expect(BASELINE).toMatch(
      /ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'global'/i,
    );
    expect(BASELINE).toMatch(/ADD CONSTRAINT knowledge_items_locale_fkey/);
    expect(BASELINE).toMatch(/ADD CONSTRAINT knowledge_chunks_locale_fkey/);
    expect(BASELINE).toMatch(/ADD CONSTRAINT knowledge_embeddings_locale_fkey/);
    // db_self_repair global arm is a function, so it lands in the baseline.
    expect(BASELINE).toMatch(/code = 'global'/);
  });
});

describe('Brick3 locale — touched fns surface locale (behavior-neutral)', () => {
  it('mcp_search_knowledge_v3 surfaces chunk_locale + NEVER hard-filters by locale (Brick5 reranks)', () => {
    expect(V3).toMatch(/RETURNS TABLE\([\s\S]*chunk_locale text\)/);
    expect(V3).toMatch(/kc\.locale AS s_chunk_locale/);
    // HARD invariant (survives Brick5): locale is NEVER a WHERE filter — the cross-lingual
    // fallback must always be reachable. Brick5 makes locale a rerank PREFERENCE only.
    expect(V3, 'v3 must not filter by locale').not.toMatch(/\bWHERE\b[^;]*\.locale\s*=/);
    // Brick5 reranks on s_eff_dist (cosine distance − a locale preference-boost); the
    // Brick3 "byte-identical ORDER BY" invariant is intentionally superseded here.
    expect(V3).toMatch(/ORDER BY s\.s_eff_dist ASC/);
    expect(V3).toMatch(/p_locale IS NOT NULL AND kc\.locale = p_locale THEN c_locale_boost/);
  });

  it('mcp_search_knowledge_v3 DROPs the old 12-arg overload before CREATE (return-shape change)', () => {
    const dropIdx = V3.search(
      /DROP FUNCTION IF EXISTS public\.mcp_search_knowledge_v3\(vector,halfvec,text,text\[\],text,text,text\[\],boolean,integer,numeric,uuid,text\)/,
    );
    const createIdx = V3.search(/CREATE OR REPLACE FUNCTION public\.mcp_search_knowledge_v3/);
    expect(dropIdx, 'v3 must DROP the old overload').toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('mcp_search_knowledge_v2 surfaces locale in the jsonb, no WHERE/score change', () => {
    // v2 is a single function since the unreachable 9-arg overload was dropped; count = 1.
    const matches = V2.match(/'locale',\s*kc\.locale/g) ?? [];
    expect(matches.length, "v2 must surface 'locale' (one function, one jsonb field)").toBe(1);
    expect(V2, 'v2 must not filter by locale').not.toMatch(/\bWHERE\b[^;]*\.locale\s*=/);
    expect(V2, 'v2 must not multiply a locale column into the score').not.toMatch(
      /\.locale[\s\S]{0,20}\*\s*\d/,
    );
  });

  it('insert_knowledge_chunk: p_locale arg, conflict on (…, locale), DROP old 6-arg + 7-arg, 10-arg grant', () => {
    expect(INS_CHUNK).toMatch(/p_locale text DEFAULT 'global'/);
    expect(INS_CHUNK).toMatch(/ON CONFLICT \(knowledge_item_id, chunk_index, locale\)/);
    // Brick3 locale dropped the pre-locale 6-arg overload…
    expect(INS_CHUNK).toMatch(
      /DROP FUNCTION IF EXISTS public\.insert_knowledge_chunk\(integer,text,uuid,text,text,integer\)/,
    );
    // …and PR-1 (#677 ingest provenance/dedup) appended p_source_hash + p_char_start
    // + p_char_end, dropping the locale-only 7-arg overload and granting the 10-arg
    // signature it actually creates. A function must grant its real signature — the
    // grant tracks the current fn, so this gate does too.
    expect(INS_CHUNK).toMatch(
      /DROP FUNCTION IF EXISTS public\.insert_knowledge_chunk\(integer,text,uuid,text,text,integer,text\)/,
    );
    expect(INS_CHUNK).toMatch(
      /GRANT EXECUTE ON FUNCTION insert_knowledge_chunk\(integer,text,uuid,text,text,integer,text,text,integer,integer\) TO service_role/,
    );
  });

  it('insert_knowledge_embedding: p_locale arg, conflict on (chunk_id, locale), DROP old 5-arg, 6-arg grant', () => {
    expect(INS_EMB).toMatch(/p_locale text DEFAULT 'global'/);
    expect(INS_EMB).toMatch(/ON CONFLICT \(chunk_id, locale\)/);
    expect(INS_EMB).toMatch(
      /DROP FUNCTION IF EXISTS public\.insert_knowledge_embedding\(uuid,text,uuid,text,text\)/,
    );
    expect(INS_EMB).toMatch(
      /GRANT EXECUTE ON FUNCTION insert_knowledge_embedding\(uuid,text,uuid,text,text,text\) TO service_role/,
    );
  });

  it('insert_knowledge_embedding_v2_audited: p_locale arg, scoped UPDATE, DROP old 4-arg, 5-arg grant', () => {
    expect(INS_EMB_V2).toMatch(/p_locale text DEFAULT 'global'/);
    expect(INS_EMB_V2).toMatch(/locale = COALESCE\(p_locale, 'global'\)/);
    expect(INS_EMB_V2).toMatch(
      /DROP FUNCTION IF EXISTS public\.insert_knowledge_embedding_v2_audited\(uuid,text,text,text\)/,
    );
    expect(INS_EMB_V2).toMatch(
      /GRANT EXECUTE ON FUNCTION insert_knowledge_embedding_v2_audited\(uuid,text,text,text,text\) TO service_role/,
    );
  });

  // Obě fronty jsou v heals: DROP téže signatury (zbytek z Brick3) by tam běžel při každém migrate.
  // Návratový tvar s locale má i nejstarší podporovaná databáze, CREATE OR REPLACE stačí.
  it('fn_get_chunks_needing_context: locale in RETURNS TABLE + SELECT, bez DROP téže signatury', () => {
    expect(GET_CHUNKS).toMatch(/RETURNS TABLE\s*\([\s\S]*\blocale\s+text/);
    expect(GET_CHUNKS).toMatch(/kc\.locale/);
    expect(GET_CHUNKS).not.toMatch(/^\s*DROP FUNCTION/m);
  });

  it('fn_get_embeddings_needing_v2: locale in RETURNS TABLE + SELECT, bez DROP téže signatury', () => {
    expect(GET_EMB_V2).toMatch(/RETURNS TABLE\s*\([\s\S]*\blocale\s+text/);
    expect(GET_EMB_V2).toMatch(/ke\.locale/);
    expect(GET_EMB_V2).not.toMatch(/^\s*DROP FUNCTION/m);
  });

  it('upsert_story_knowledge_item_audited threads p_locale (Brick4 superseded the global-sentinel stub)', () => {
    // Brick3 hardcoded 'global'; Brick4 added the trailing p_locale param (10 → 11
    // args) so the written value is COALESCE(p_locale, 'global'). Full contract lives
    // in src/tests/gates/brick4-locale-ingestion.gate.test.ts.
    expect(UPSERT).toMatch(/story_id, author_id, status, locale/);
    expect(UPSERT).toMatch(/p_locale\s+text DEFAULT 'global'/);
    expect(UPSERT).toMatch(/COALESCE\(p_locale, 'global'\)/);
    // arita se od Brick4 posunula (11 → 14, provenience zdroje); pinuje se
    // vlastnost „grant sedí na aktuálním podpisu", ne konkrétní číslo z minula.
    expect(UPSERT).toMatch(
      /uuid, uuid, text, text, text, text, text, text\[\], text, text, text, text, text, text\n?\s*\) TO authenticated/,
    );
  });
});

describe('Brick3 locale — TS route threads the item/row locale (Brick4 superseded the global sentinel)', () => {
  it('knowledge-embeddings.ts passes the real locale (item.locale / row.locale), not the global stub', () => {
    // Brick3 stubbed p_locale: 'global' at the write sites; Brick4 threads the item's
    // / row's actual locale, so the global pins are gone.
    expect(TS_ROUTE).not.toMatch(/p_locale:\s*'global'/);
    const itemLocale = TS_ROUTE.match(/p_locale:\s*item\.locale/g) ?? [];
    expect(itemLocale.length, 'chunk + embedding writes thread item.locale').toBeGreaterThanOrEqual(2);
    expect(TS_ROUTE).toMatch(/p_locale:\s*row\.locale/);
  });
});

describe('Brick3 locale — pgTAP runtime proof exists', () => {
  it('03_locale_foundation.sql asserts default/23503/coexistence/no-cascade', () => {
    expect(PGTAP.length, 'pgTAP suite must exist').toBeGreaterThan(0);
    // default → 'global'
    expect(PGTAP).toMatch(/'global'/);
    // locale='zz' (unregistered) → 23503 FK violation
    expect(PGTAP).toMatch(/throws_ok[\s\S]{0,400}'23503'/);
    // two chunks same (item, chunk_index) different locale coexist
    expect(PGTAP).toMatch(/lives_ok/);
    // FK does NOT cascade-delete on language removal
    expect(PGTAP).toMatch(/cascade/i);
  });
});
