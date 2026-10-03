-- pgTAP schema-contract tests — Brick5 cross-lingual retrieval (v3)
-- ============================================================================
-- mcp_search_knowledge_v3 with p_locale preference-boost + source_concept_id variant
-- dedup. Two locale variants (cs/en) of ONE source node (shared source_id ⇒ shared
-- source_concept_id) must:
--   (1) collapse to a single winning row (no N near-duplicate variants);
--   (2)/(3) p_locale picks WHICH variant wins (rerank preference, not a hard filter);
--   (4) a single-variant concept is unaffected (no regression);
--   (5) a NULL source_concept_id row is still returned (COALESCE → own id, not dropped).
-- Triggers are disabled around the fixtures (the AFTER-INSERT embedding-queue hook) and
-- source_concept_id is set explicitly, so the test is deterministic and also exercises
-- the NULL-concept path that DISABLE TRIGGER produces in the wild.
-- Runs UNSEEDED as service_role (p_story_id NULL ⇒ global items) in a rolled-back txn.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('global','Global','languages.global.name',true,false,0),
         ('cs','Cestina','languages.cs.name',true,false,1),
         ('en','English','languages.en.name',true,false,2)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

SELECT set_config('b5.concept', gen_random_uuid()::text, true);  -- shared source_id == concept
SELECT set_config('b5.cs',    gen_random_uuid()::text, true);
SELECT set_config('b5.en',    gen_random_uuid()::text, true);
SELECT set_config('b5.solo',  gen_random_uuid()::text, true);
SELECT set_config('b5.nullc', gen_random_uuid()::text, true);
-- Rozměr se NEDEKLARUJE — test si ho vezme ze SLOUPCE (pgvector nese dimenzi
-- v atttypmod). Napsaný natvrdo zastaral ve chvíli, kdy v1 prostor přešel
-- z cloudových 1536 na 1024 pro bge-m3, a sedm testů spadlo na fixtuře,
-- ne na testované vlastnosti.
SELECT set_config('b5.qvec', '[1' || repeat(',0',
                        (SELECT atttypmod - 1 FROM pg_attribute
                        WHERE attrelid = 'knowledge_embeddings'::regclass
                          AND attname  = 'embedding')) || ']', true);  -- 1536-dim [1,0,…,0]

-- Disable USER triggers (suppress the embedding-queue AFTER-INSERT hook) + set
-- source_concept_id explicitly. The two variants share the concept; nullc is left NULL.
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
INSERT INTO knowledge_items (id, item_type, source_type, source_id, source_slug, locale, source_concept_id, title, body_markdown, status, visibility, version)
  VALUES
   (current_setting('b5.cs')::uuid,   'domain_doc','guild_db', current_setting('b5.concept')::uuid, 'b5-doc', 'cs',     current_setting('b5.concept')::uuid, 't','b','active','public',1),
   (current_setting('b5.en')::uuid,   'domain_doc','guild_db', current_setting('b5.concept')::uuid, 'b5-doc', 'en',     current_setting('b5.concept')::uuid, 't','b','active','public',1),
   (current_setting('b5.solo')::uuid, 'domain_doc','manual',   NULL,                                 'b5-solo','global', current_setting('b5.solo')::uuid,    't','b','active','public',1),
   (current_setting('b5.nullc')::uuid,'domain_doc','manual',   NULL,                                 'b5-null','global', NULL,                                't','b','active','public',1);
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, locale) VALUES
   (current_setting('b5.cs')::uuid,    current_setting('b5.cs')::uuid,    0, 'cs text',   'cs'),
   (current_setting('b5.en')::uuid,    current_setting('b5.en')::uuid,    0, 'en text',   'en'),
   (current_setting('b5.solo')::uuid,  current_setting('b5.solo')::uuid,  0, 'solo text', 'global'),
   (current_setting('b5.nullc')::uuid, current_setting('b5.nullc')::uuid, 0, 'null text', 'global');
INSERT INTO knowledge_embeddings (chunk_id, knowledge_item_id, embedding) VALUES
   (current_setting('b5.cs')::uuid,    current_setting('b5.cs')::uuid,    current_setting('b5.qvec')::vector),
   (current_setting('b5.en')::uuid,    current_setting('b5.en')::uuid,    current_setting('b5.qvec')::vector),
   (current_setting('b5.solo')::uuid,  current_setting('b5.solo')::uuid,  current_setting('b5.qvec')::vector),
   (current_setting('b5.nullc')::uuid, current_setting('b5.nullc')::uuid, current_setting('b5.qvec')::vector);

SET LOCAL ROLE service_role;

-- (1) DEDUP — the two cs/en variants of one concept collapse to a single winning row.
SELECT is(
  (SELECT count(*)::int FROM mcp_search_knowledge_v3(
     p_query_embedding_v1 := current_setting('b5.qvec')::vector, p_model_pref := 'v1', p_similarity_threshold := 0, p_limit := 50)
   WHERE knowledge_item_id IN (current_setting('b5.cs')::uuid, current_setting('b5.en')::uuid)),
  1, '(1) cross-lingual variants of one source_concept collapse to a single winning row');

-- (2) BOOST cs — p_locale=cs reranks the cs variant to win the concept.
SELECT is(
  (SELECT knowledge_item_id FROM mcp_search_knowledge_v3(
     p_query_embedding_v1 := current_setting('b5.qvec')::vector, p_model_pref := 'v1', p_similarity_threshold := 0, p_limit := 50, p_locale := 'cs')
   WHERE knowledge_item_id IN (current_setting('b5.cs')::uuid, current_setting('b5.en')::uuid)),
  current_setting('b5.cs')::uuid, '(2) p_locale=cs boosts the cs variant to win the concept');

-- (3) BOOST en — p_locale=en reranks the en variant to win.
SELECT is(
  (SELECT knowledge_item_id FROM mcp_search_knowledge_v3(
     p_query_embedding_v1 := current_setting('b5.qvec')::vector, p_model_pref := 'v1', p_similarity_threshold := 0, p_limit := 50, p_locale := 'en')
   WHERE knowledge_item_id IN (current_setting('b5.cs')::uuid, current_setting('b5.en')::uuid)),
  current_setting('b5.en')::uuid, '(3) p_locale=en boosts the en variant to win the concept');

-- (4) NO REGRESSION — a single-variant concept is unaffected by dedup.
SELECT is(
  (SELECT count(*)::int FROM mcp_search_knowledge_v3(
     p_query_embedding_v1 := current_setting('b5.qvec')::vector, p_model_pref := 'v1', p_similarity_threshold := 0, p_limit := 50)
   WHERE knowledge_item_id = current_setting('b5.solo')::uuid),
  1, '(4) a single-variant concept is unaffected by dedup (no regression)');

-- (5) NULL-CONCEPT ROBUSTNESS — a NULL source_concept_id row is still returned.
SELECT is(
  (SELECT count(*)::int FROM mcp_search_knowledge_v3(
     p_query_embedding_v1 := current_setting('b5.qvec')::vector, p_model_pref := 'v1', p_similarity_threshold := 0, p_limit := 50)
   WHERE knowledge_item_id = current_setting('b5.nullc')::uuid),
  1, '(5) a NULL source_concept_id row is not dropped (COALESCE to own id)');

SELECT * FROM finish();
ROLLBACK;
