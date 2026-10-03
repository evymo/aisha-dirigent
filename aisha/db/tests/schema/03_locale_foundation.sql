-- pgTAP schema-contract tests — RAG locale foundation (Brick3)
-- ============================================================================
-- Runtime proof for the behavior-neutral `locale` axis added to the knowledge
-- layer. Every assertion runs against the APPLIED (UNSEEDED) cold-start schema
-- as superuser inside a rolled-back txn, so fixtures bypass RLS and nothing
-- persists. The 'global' sentinel is NOT seeded by migrate.mjs, so this suite
-- inserts the supported_languages rows it needs as fixtures.
--
-- Asserted:
--   (1) DEFAULT: a knowledge_items / _chunks / _embeddings row written without a
--       locale gets 'global'.
--   (2) FK ENFORCED: a chunk with an unregistered locale ('zz') → 23503.
--   (3) CROSS-LOCALE COEXISTENCE: two chunks with the same (knowledge_item_id,
--       chunk_index) but different locale coexist (widened unique includes locale).
--   (4) RETRIEVAL NEUTRAL: mcp_search_knowledge_v3 returns the 'global' chunk for a
--       story owner and surfaces chunk_locale='global'; mcp_search_knowledge_v2
--       (story overload) returns a row whose jsonb carries locale='global'.
--   (5) NO CASCADE: deleting a language that still has dependent knowledge rows is
--       REFUSED (23503) — removing a language must NEVER cascade-delete the corpus.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

-- ── Parametric identities / keys / a 1536-dim query vector (session GUCs) ────
SELECT set_config('loc.owner',        gen_random_uuid()::text, true);
SELECT set_config('loc.story',        gen_random_uuid()::text, true);
SELECT set_config('loc.item',         gen_random_uuid()::text, true);
SELECT set_config('loc.chunk_global', gen_random_uuid()::text, true);
SELECT set_config('loc.chunk_cs',     gen_random_uuid()::text, true);
SELECT set_config('loc.zz_item',      gen_random_uuid()::text, true);
-- Non-zero 1536-dim vector ([1,0,…,0]); query == chunk embedding ⇒ cosine = 1.
-- Rozměr se NEDEKLARUJE — test si ho vezme ze SLOUPCE (pgvector nese dimenzi
-- v atttypmod). Napsaný natvrdo zastaral ve chvíli, kdy v1 prostor přešel
-- z cloudových 1536 na 1024 pro bge-m3, a sedm testů spadlo na fixtuře,
-- ne na testované vlastnosti.
SELECT set_config('loc.qvec', '[1' || repeat(',0',
                        (SELECT atttypmod - 1 FROM pg_attribute
                        WHERE attrelid = 'knowledge_embeddings'::regclass
                          AND attname  = 'embedding')) || ']', true);

-- ── Language fixtures (sentinel + a real second language for coexistence) ────
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
VALUES
  ('global', 'Global',  'languages.global.name', true, false, 0),
  ('cs',     'Čeština', 'languages.cs.name',     true, true,  1)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

-- ── Story + owner fixtures ───────────────────────────────────────────────────
INSERT INTO aisha_auth.users (id) VALUES (current_setting('loc.owner')::uuid);
INSERT INTO partner_stories (id, user_id, title)
  VALUES (current_setting('loc.story')::uuid, current_setting('loc.owner')::uuid,
          'Locale foundation test story');

-- ════════════════════════════════════════════════════════════════════════════
-- (1) DEFAULT → 'global'
-- ════════════════════════════════════════════════════════════════════════════
-- Triggers off so the AFTER INSERT embedding-queue hook doesn't fire on fixtures.
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
INSERT INTO knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status)
  VALUES (current_setting('loc.item')::uuid, 'domain_doc', 'Locale doc', 'body',
          current_setting('loc.story')::uuid, 'public', 'active');
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

SELECT is(
  (SELECT locale FROM knowledge_items WHERE id = current_setting('loc.item')::uuid),
  'global',
  '(1a) knowledge_items.locale defaults to global');

INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
  VALUES (current_setting('loc.chunk_global')::uuid, current_setting('loc.item')::uuid, 0, 'global chunk text');
SELECT is(
  (SELECT locale FROM knowledge_chunks WHERE id = current_setting('loc.chunk_global')::uuid),
  'global',
  '(1b) knowledge_chunks.locale defaults to global');

INSERT INTO knowledge_embeddings (chunk_id, knowledge_item_id, embedding)
  VALUES (current_setting('loc.chunk_global')::uuid, current_setting('loc.item')::uuid,
          current_setting('loc.qvec')::vector);
SELECT is(
  (SELECT locale FROM knowledge_embeddings WHERE chunk_id = current_setting('loc.chunk_global')::uuid),
  'global',
  '(1c) knowledge_embeddings.locale defaults to global');

-- ════════════════════════════════════════════════════════════════════════════
-- (2) FK ENFORCED: an unregistered locale is rejected (23503)
-- ════════════════════════════════════════════════════════════════════════════
SELECT throws_ok(
  $$ INSERT INTO knowledge_chunks (knowledge_item_id, chunk_index, chunk_text, locale)
     VALUES (current_setting('loc.item')::uuid, 99, 'zz chunk', 'zz') $$,
  '23503', NULL,
  '(2) chunk with unregistered locale (zz) is rejected by the locale FK (23503)');

-- ════════════════════════════════════════════════════════════════════════════
-- (3) CROSS-LOCALE COEXISTENCE: same (item, chunk_index), different locale
-- ════════════════════════════════════════════════════════════════════════════
SELECT lives_ok(
  $$ INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, locale)
     VALUES (current_setting('loc.chunk_cs')::uuid, current_setting('loc.item')::uuid, 0, 'cs chunk text', 'cs') $$,
  '(3) a second chunk with same (item, chunk_index) but locale=cs coexists (widened unique)');

SELECT is(
  (SELECT count(*)::int FROM knowledge_chunks
     WHERE knowledge_item_id = current_setting('loc.item')::uuid AND chunk_index = 0),
  2,
  '(3b) both global and cs chunks at (item, chunk_index 0) are present');

-- ════════════════════════════════════════════════════════════════════════════
-- (4) RETRIEVAL NEUTRAL: v3 returns the global chunk + surfaces chunk_locale;
--     v2 (story overload) returns a row carrying locale='global'.
-- ════════════════════════════════════════════════════════════════════════════
-- v3 as the story owner (auth.uid = owner, role authenticated).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('loc.owner'), 'role', 'authenticated')::text, true);
SELECT is(
  (SELECT chunk_locale FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('loc.qvec')::vector,
            p_story_id := current_setting('loc.story')::uuid,
            p_model_pref := 'v1')
     WHERE chunk_id = current_setting('loc.chunk_global')::uuid),
  'global',
  '(4a) mcp_search_knowledge_v3 returns the global chunk and surfaces chunk_locale=global');

-- v2 story-scoped overload as service_role. KONTRAKT ZMĚNĚN 2026-07-30 (RAG
-- retrieval fix): service_role už story guard NEOBCHÁZÍ — smí jen říct, ZA KOHO
-- se ptá (p_audience_user_id, Brick6). Bez identity zbývá veřejná/globální
-- vrstva — fail-closed. Stará podoba téhle aserce pinovala právě ten bypass.
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      mcp_search_knowledge_v2(
        p_query_embedding := current_setting('loc.qvec')::vector,
        p_story_id := current_setting('loc.story')::uuid,
        p_audience_user_id := current_setting('loc.owner')::uuid)
    ) AS r
    WHERE r->>'locale' = 'global'
  ),
  '(4b) mcp_search_knowledge_v2 (story overload) surfaces locale=global for the story owner audience');

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      mcp_search_knowledge_v2(
        p_query_embedding := current_setting('loc.qvec')::vector,
        p_story_id := current_setting('loc.story')::uuid)
    ) AS r
    WHERE r->>'locale' = 'global'
  ),
  '(4c) without an audience, service_role does NOT reach story-scoped content (fail-closed, no bypass)');
SELECT set_config('request.jwt.claims', NULL, true);

-- ════════════════════════════════════════════════════════════════════════════
-- (5) NO CASCADE: removing a language that still has dependent rows is REFUSED.
--     A cascade would silently delete the item; NO ACTION raises 23503 instead.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('zz', 'Test', 'languages.zz.name', true, false, 99) ON CONFLICT (code) DO NOTHING;
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
INSERT INTO knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status, locale)
  VALUES (current_setting('loc.zz_item')::uuid, 'domain_doc', 'zz doc', 'body',
          NULL, 'public', 'active', 'zz');
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

SELECT throws_ok(
  $$ DELETE FROM supported_languages WHERE code = 'zz' $$,
  '23503', NULL,
  '(5a) deleting a language with dependent knowledge_items is refused (no cascade, 23503)');
-- The item still exists (proving nothing cascade-deleted it).
SELECT isnt_empty(
  $$ SELECT id FROM knowledge_items WHERE id = current_setting('loc.zz_item')::uuid $$,
  '(5b) the zz-locale item survives the refused language delete (no cascade)');

SELECT * FROM finish();
ROLLBACK;
