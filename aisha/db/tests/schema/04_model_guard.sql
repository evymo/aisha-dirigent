-- pgTAP schema-contract tests — RAG model-identity guard (Brick2)
-- ============================================================================
-- Runtime proof for the embedding-model-identity axis added in Brick2. Every
-- assertion runs against the APPLIED (UNSEEDED) cold-start schema as superuser
-- inside a rolled-back txn, so fixtures bypass RLS and nothing persists. The
-- model registry is NOT seeded by migrate.mjs in a way this suite can rely on,
-- so it inserts every ai_provider_registry / ai_model_registry / knowledge_*
-- row it references as a fixture (same discipline as 03_locale_foundation.sql).
--
-- The invariant under test (model-as-index-constant): a query embedded by model X
-- may only be cosine-compared against chunks embedded by model X. Brick2 enforces
-- this with (1) a space→model resolver that dim-routes to the corpus column, (2) a
-- HARD WHERE p_query_model filter in mcp_search_knowledge_v3, and (3) a fail-loud
-- model_registry FK PIN on the embedding writer.
--
-- Asserted:
--   (a) fn_resolve_embedding_model_for_space('v2') returns the 2560-dim model.
--   (b) ('v1') returns the 1024-dim model (bge-m3 native).
--   (c) resolver returns 0 rows when no enabled+healthy embedding model exists
--       (the caller MUST fail loud / degrade to text-only — never substitute).
--   (d) v3 with p_query_model = the WRONG model id (vs a chunk embedded by the
--       right model) → 0 rows (cross-model reject).
--   (e) v3 with p_query_model = the RIGHT model id → returns the chunk.
--   (f) v3 with p_query_model NULL → returns the chunk (back-compat, no filter).
--   (g) insert_knowledge_embedding with an UNREGISTERED p_model → 23503
--       (fail-loud; never silently writes a NULL model_registry_id).
--   (h) insert_knowledge_embedding with a registered model → writes a row whose
--       model_registry_id = the seeded registry id.
--   (i) deleting the ai_model_registry row an embedding references → 23503
--       (FK no-cascade; the corpus survives a model row delete).
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

-- ── Parametric identities / keys / a query vector sized from the column ─────
SELECT set_config('mg.owner',       gen_random_uuid()::text, true);
SELECT set_config('mg.story',       gen_random_uuid()::text, true);
SELECT set_config('mg.item',        gen_random_uuid()::text, true);
SELECT set_config('mg.chunk',       gen_random_uuid()::text, true);
SELECT set_config('mg.chunk_ins',   gen_random_uuid()::text, true);
SELECT set_config('mg.prov_v1',     gen_random_uuid()::text, true);
SELECT set_config('mg.prov_v2',     gen_random_uuid()::text, true);
SELECT set_config('mg.reg_v1',      gen_random_uuid()::text, true);
SELECT set_config('mg.reg_v2',      gen_random_uuid()::text, true);
-- Non-zero vector ([1,0,…,0]); query == chunk embedding ⇒ cosine = 1.
-- Rozměr se NEDEKLARUJE — test si ho vezme ze SLOUPCE (pgvector nese dimenzi
-- v atttypmod). Napsaný natvrdo zastaral ve chvíli, kdy v1 prostor přešel
-- z cloudových 1536 na 1024 pro bge-m3, a sedm testů spadlo na fixtuře,
-- ne na testované vlastnosti.
SELECT set_config('mg.qvec', '[1' || repeat(',0',
                        (SELECT atttypmod - 1 FROM pg_attribute
                        WHERE attrelid = 'knowledge_embeddings'::regclass
                          AND attname  = 'embedding')) || ']', true);

-- ── Provider fixtures (enabled + healthy so the resolver returns them) ───────
INSERT INTO ai_provider_registry (id, slug, display_name, backend_kind, endpoint_url, auth_env_var, is_enabled, last_health_status)
VALUES
  (current_setting('mg.prov_v1')::uuid, 'mg-prov-v1', 'MG Provider v1', 'direct_cloud', 'https://v1.example.invalid', 'MG_V1_KEY', true,  'healthy'),
  (current_setting('mg.prov_v2')::uuid, 'mg-prov-v2', 'MG Provider v2', 'local_vllm',   'http://v2.example.invalid:8000', 'MG_V2_KEY', true, 'healthy');

-- ── Model fixtures: a 1024-dim v1 model + a 2560-dim v2 model (both embedding) ─
-- model_id is the human-readable identity threaded as p_query_model. The 2560-dim
-- one must dim-route to space 'v2'; the 1024-dim one to 'v1'. A model of any
-- OTHER dimension routes nowhere — which is why the old 1536 fixture stopped
-- resolving when the v1 space moved off the cloud model.
INSERT INTO ai_model_registry
  (id, provider, model_id, is_embedding, embedding_dimensions, is_available, is_deprecated, provider_registry_id)
VALUES
  (current_setting('mg.reg_v1')::uuid, 'mg-prov-v1', 'mg-embed-1024', true, 1024, true, false, current_setting('mg.prov_v1')::uuid),
  (current_setting('mg.reg_v2')::uuid, 'mg-prov-v2', 'mg-embed-2560', true, 2560, true, false, current_setting('mg.prov_v2')::uuid);

-- ── Language fixture: the 'global' sentinel the Brick3 locale FK requires ────
-- knowledge_items/_chunks/_embeddings default locale='global'; this suite runs
-- UNSEEDED, so supported_languages('global') must exist before any corpus write.
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('global', 'Global', 'languages.global.name', true, false, 0)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

-- ── Story + owner + corpus fixtures ─────────────────────────────────────────
INSERT INTO aisha_auth.users (id) VALUES (current_setting('mg.owner')::uuid);
INSERT INTO partner_stories (id, user_id, title)
  VALUES (current_setting('mg.story')::uuid, current_setting('mg.owner')::uuid, 'Model guard test story');

-- Triggers off so the AFTER INSERT embedding-queue hook doesn't fire on fixtures.
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
INSERT INTO knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status)
  VALUES (current_setting('mg.item')::uuid, 'domain_doc', 'Model guard doc', 'body',
          current_setting('mg.story')::uuid, 'public', 'active');
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
  VALUES (current_setting('mg.chunk')::uuid, current_setting('mg.item')::uuid, 0, 'model guard chunk text');

-- The corpus chunk is embedded by the v1 model ('mg-embed-1024'): its `model`
-- text mirror is what the v3 p_query_model HARD WHERE compares against.
INSERT INTO knowledge_embeddings (chunk_id, knowledge_item_id, embedding, model, model_registry_id)
  VALUES (current_setting('mg.chunk')::uuid, current_setting('mg.item')::uuid,
          current_setting('mg.qvec')::vector, 'mg-embed-1024', current_setting('mg.reg_v1')::uuid);

-- ════════════════════════════════════════════════════════════════════════════
-- (a)+(b) RESOLVER dim-routing: space 'v2' ⇒ 2560 model, 'v1' ⇒ 1024 model.
--   The resolver's auth gate is the 67-fn service-resolver idiom
--   `auth.uid() IS NULL AND current_setting('role') != 'service_role'` (shared
--   with fn_resolve_embedding_model / fn_resolve_runtime / v3:24). In prod
--   PostgREST issues `SET ROLE service_role` from the validated JWT; pgTAP as
--   superuser must replicate that with `SET LOCAL ROLE service_role`. Setting
--   only request.jwt.claims is NOT enough — current_setting('role') reads the PG
--   session role, which otherwise stays `postgres`. The fixture UPDATEs in (c)
--   run as the superuser, so RESET ROLE around them.
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

SELECT is(
  (SELECT model_id FROM public.fn_resolve_embedding_model_for_space('v2')),
  'mg-embed-2560',
  '(a) fn_resolve_embedding_model_for_space(v2) dim-routes to the 2560-dim model');

SELECT is(
  (SELECT model_id FROM public.fn_resolve_embedding_model_for_space('v1')),
  'mg-embed-1024',
  '(b) fn_resolve_embedding_model_for_space(v1) dim-routes to the 1024-dim model');

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- (c) RESOLVER fails loud: with NO enabled+healthy embedding model the function
--     returns 0 rows. Disable both providers (superuser), then resolve as
--     service_role.
-- ════════════════════════════════════════════════════════════════════════════
UPDATE ai_provider_registry SET is_enabled = false
  WHERE id IN (current_setting('mg.prov_v1')::uuid, current_setting('mg.prov_v2')::uuid);
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM public.fn_resolve_embedding_model_for_space('v1')),
  0,
  '(c) resolver returns 0 rows when no enabled+healthy embedding model exists (caller fails loud)');
RESET ROLE;
-- Re-enable so the rest of the suite has live providers (back-compat callers).
UPDATE ai_provider_registry SET is_enabled = true
  WHERE id IN (current_setting('mg.prov_v1')::uuid, current_setting('mg.prov_v2')::uuid);

-- ════════════════════════════════════════════════════════════════════════════
-- (d)+(e)+(f) CROSS-MODEL GUARD in mcp_search_knowledge_v3 (v1 arm).
--   The chunk was embedded by 'mg-embed-1024'. Run as the story owner.
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('mg.owner'), 'role', 'authenticated')::text, true);

-- (d) WRONG model id ⇒ the HARD WHERE rejects the chunk → 0 rows.
SELECT is(
  (SELECT count(*)::int FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('mg.qvec')::vector,
            p_story_id := current_setting('mg.story')::uuid,
            p_model_pref := 'v1',
            p_query_model := 'mg-embed-2560')),
  0,
  '(d) v3 with the WRONG p_query_model rejects the chunk (cross-model reject, 0 rows)');

-- (e) RIGHT model id ⇒ the chunk passes the HARD WHERE → returned.
SELECT is(
  (SELECT chunk_id FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('mg.qvec')::vector,
            p_story_id := current_setting('mg.story')::uuid,
            p_model_pref := 'v1',
            p_query_model := 'mg-embed-1024')),
  current_setting('mg.chunk')::uuid,
  '(e) v3 with the RIGHT p_query_model returns the chunk');

-- (f) NULL model id ⇒ no filter (back-compat) → chunk returned.
SELECT is(
  (SELECT chunk_id FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('mg.qvec')::vector,
            p_story_id := current_setting('mg.story')::uuid,
            p_model_pref := 'v1',
            p_query_model := NULL)),
  current_setting('mg.chunk')::uuid,
  '(f) v3 with p_query_model NULL returns the chunk (back-compat, no model filter)');

-- ════════════════════════════════════════════════════════════════════════════
-- (g)+(h) WRITER fail-loud + PIN. insert_knowledge_embedding requires service_role
--   and resolves model_registry_id from p_model, raising 23503 if unregistered.
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

-- (g) An unregistered model name fails loud with 23503 (never a silent NULL pin).
SELECT throws_ok(
  format(
    $$ SELECT public.insert_knowledge_embedding(%L::uuid, %L, %L::uuid, %L) $$,
    current_setting('mg.chunk_ins'), current_setting('mg.qvec'),
    current_setting('mg.item'), 'mg-not-registered'),
  '23503', NULL,
  '(g) insert_knowledge_embedding with an UNREGISTERED model throws 23503 (fail-loud)');

-- (h) A registered model writes a row whose model_registry_id = the seeded id.
-- Need a fresh chunk so the (chunk_id, locale) unique does not collide with (e)'s row.
INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
  VALUES (current_setting('mg.chunk_ins')::uuid, current_setting('mg.item')::uuid, 1, 'writer pin chunk');
-- Bare SELECT runs the writer for its side effect (the returned jsonb is discarded).
SELECT public.insert_knowledge_embedding(
  current_setting('mg.chunk_ins')::uuid, current_setting('mg.qvec'),
  current_setting('mg.item')::uuid, 'mg-embed-1024');
SELECT is(
  (SELECT model_registry_id FROM knowledge_embeddings
     WHERE chunk_id = current_setting('mg.chunk_ins')::uuid),
  current_setting('mg.reg_v1')::uuid,
  '(h) insert_knowledge_embedding pins model_registry_id to the registered model row');

-- ════════════════════════════════════════════════════════════════════════════
-- (i) NO CASCADE: deleting the ai_model_registry row an embedding references is
--     REFUSED (23503). A cascade would silently delete the corpus embedding.
-- ════════════════════════════════════════════════════════════════════════════
SELECT throws_ok(
  format($$ DELETE FROM public.ai_model_registry WHERE id = %L::uuid $$, current_setting('mg.reg_v1')),
  '23503', NULL,
  '(i) deleting the model_registry row an embedding references is refused (FK no-cascade, 23503)');

SELECT * FROM finish();
ROLLBACK;
