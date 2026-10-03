-- pgTAP schema-contract tests — Brick4 locale-aware ingestion
-- ============================================================================
-- Runtime proof for the locale-aware ingestion axis (Brick4): per-(source,locale)
-- knowledge_items (widened guild_db unique), per-locale clear (re-ingesting one
-- locale never wipes sibling locales), and the p_locale param threaded through the
-- story-knowledge upsert. Runs against the APPLIED (UNSEEDED) cold-start schema as
-- superuser inside a rolled-back txn; fixtures bypass RLS and nothing persists.
--
-- Asserted:
--   (1) per-(source,locale) coexistence: two guild_db items with the same
--       (source_type, source_id) but different locale COEXIST on the widened
--       unique; a second same-locale row still collides (23505).
--   (2) per-locale clear: clear_knowledge_item_chunks(item, 'cs') removes only the
--       cs chunks; the en siblings survive (the pre-Brick4 all-locale wipe is gone).
--   (3) clear-all back-compat: clear_knowledge_item_chunks(item) with NULL locale
--       removes everything that remains.
--   (4) upsert threads locale: upsert_story_knowledge_item_audited(..., p_locale)
--       writes that locale; omitting it defaults to 'global'.
--   (5) item locale FK fail-loud: an unregistered item locale is rejected (23503).
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);

-- ── Identities / keys / a 1536-dim vector (session GUCs) ─────────────────────
SELECT set_config('ing.admin',    gen_random_uuid()::text, true);
SELECT set_config('ing.story',    gen_random_uuid()::text, true);
SELECT set_config('ing.src_cs',   gen_random_uuid()::text, true);
SELECT set_config('ing.src_en',   gen_random_uuid()::text, true);
SELECT set_config('ing.sid',      gen_random_uuid()::text, true);  -- shared guild_db source_id
SELECT set_config('ing.clr_item', gen_random_uuid()::text, true);
SELECT set_config('ing.cs_chunk', gen_random_uuid()::text, true);
SELECT set_config('ing.en_chunk', gen_random_uuid()::text, true);
SELECT set_config('ing.zz_item',  gen_random_uuid()::text, true);
-- Rozměr se NEDEKLARUJE — test si ho vezme ze SLOUPCE (pgvector nese dimenzi
-- v atttypmod). Napsaný natvrdo zastaral ve chvíli, kdy v1 prostor přešel
-- z cloudových 1536 na 1024 pro bge-m3, a sedm testů spadlo na fixtuře,
-- ne na testované vlastnosti.
SELECT set_config('ing.qvec', '[1' || repeat(',0',
                        (SELECT atttypmod - 1 FROM pg_attribute
                        WHERE attrelid = 'knowledge_embeddings'::regclass
                          AND attname  = 'embedding')) || ']', true);

-- ── Language fixtures (sentinel + two real locales) ──────────────────────────
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
VALUES
  ('global', 'Global',  'languages.global.name', true, false, 0),
  ('cs',     'Čeština', 'languages.cs.name',     true, true,  1),
  ('en',     'English', 'languages.en.name',     true, false, 2)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

-- ── Admin user (is_admin_or_staff reads public.user_roles) + story ───────────
INSERT INTO aisha_auth.users (id) VALUES (current_setting('ing.admin')::uuid);
INSERT INTO public.user_roles (user_id, role) VALUES (current_setting('ing.admin')::uuid, 'admin');
INSERT INTO partner_stories (id, user_id, title)
  VALUES (current_setting('ing.story')::uuid, current_setting('ing.admin')::uuid, 'Brick4 ingestion test story');

-- ════════════════════════════════════════════════════════════════════════════
-- (1) per-(source, locale) coexistence on the widened guild_db unique
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
SELECT lives_ok($$
  INSERT INTO knowledge_items (id, item_type, title, body_markdown, source_type, source_id, visibility, status, locale)
  VALUES
    (current_setting('ing.src_cs')::uuid, 'domain_doc', 'cs doc', 'b', 'guild_db', current_setting('ing.sid')::uuid, 'public', 'active', 'cs'),
    (current_setting('ing.src_en')::uuid, 'domain_doc', 'en doc', 'b', 'guild_db', current_setting('ing.sid')::uuid, 'public', 'active', 'en')
$$, '(1a) two guild_db items with the same source_id but locale cs vs en coexist (widened unique)');

SELECT throws_ok($$
  INSERT INTO knowledge_items (item_type, title, body_markdown, source_type, source_id, visibility, status, locale)
  VALUES ('domain_doc', 'cs dup', 'b', 'guild_db', current_setting('ing.sid')::uuid, 'public', 'active', 'cs')
$$, '23505', NULL, '(1b) a second cs item for the same source_id still collides (unique fires within a locale)');

-- ════════════════════════════════════════════════════════════════════════════
-- (2)+(3) per-locale clear vs clear-all over knowledge_chunks/_embeddings
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status, locale)
  VALUES (current_setting('ing.clr_item')::uuid, 'domain_doc', 'clr', 'b', current_setting('ing.story')::uuid, 'public', 'active', 'global');
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

-- cs + en chunks at the same chunk_index (the Brick3 widened chunk unique allows it)
INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, locale)
VALUES
  (current_setting('ing.cs_chunk')::uuid, current_setting('ing.clr_item')::uuid, 0, 'cs chunk', 'cs'),
  (current_setting('ing.en_chunk')::uuid, current_setting('ing.clr_item')::uuid, 0, 'en chunk', 'en');
INSERT INTO knowledge_embeddings (chunk_id, knowledge_item_id, embedding, locale, model)
VALUES
  (current_setting('ing.cs_chunk')::uuid, current_setting('ing.clr_item')::uuid, current_setting('ing.qvec')::vector, 'cs', 'text-embedding-3-small'),
  (current_setting('ing.en_chunk')::uuid, current_setting('ing.clr_item')::uuid, current_setting('ing.qvec')::vector, 'en', 'text-embedding-3-small');

SELECT is(
  (SELECT count(*)::int FROM knowledge_chunks WHERE knowledge_item_id = current_setting('ing.clr_item')::uuid),
  2,
  '(2a) cs + en chunks both physically exist before the clear');

-- per-locale clear as service_role (clear_knowledge_item_chunks gates on get_jwt_role — claim only)
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SELECT lives_ok(
  $$ SELECT public.clear_knowledge_item_chunks(current_setting('ing.clr_item')::uuid, 'cs') $$,
  '(2b) per-locale clear(cs) runs as service_role');
SELECT set_config('request.jwt.claims', NULL, true);

SELECT is(
  (SELECT count(*)::int FROM knowledge_chunks WHERE knowledge_item_id = current_setting('ing.clr_item')::uuid AND locale = 'cs'),
  0,
  '(2c) the cs chunk is gone after the per-locale clear');
SELECT is(
  (SELECT count(*)::int FROM knowledge_chunks WHERE knowledge_item_id = current_setting('ing.clr_item')::uuid AND locale = 'en'),
  1,
  '(2d) the en sibling chunk survives the cs-only clear');

SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SELECT public.clear_knowledge_item_chunks(current_setting('ing.clr_item')::uuid);  -- NULL locale ⇒ all
SELECT set_config('request.jwt.claims', NULL, true);
SELECT is(
  (SELECT count(*)::int FROM knowledge_chunks WHERE knowledge_item_id = current_setting('ing.clr_item')::uuid),
  0,
  '(3) clear-all (NULL locale) removes the remaining en chunk too');

-- ════════════════════════════════════════════════════════════════════════════
-- (4) upsert_story_knowledge_item_audited threads p_locale (admin auth)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('ing.admin'), 'role', 'authenticated')::text, true);
-- Call the upsert ONCE per case (a volatile function in a WHERE clause is evaluated
-- per scanned row), stash the returned id in a GUC, then read that row's locale.
SELECT set_config('ing.up_cs', public.upsert_story_knowledge_item_audited(
     p_story_id := current_setting('ing.story')::uuid,
     p_title := 'cs upsert', p_body_markdown := 'body', p_locale := 'cs')::text, true);
SELECT is(
  (SELECT locale FROM knowledge_items WHERE id = current_setting('ing.up_cs')::uuid),
  'cs',
  '(4a) upsert_story_knowledge_item_audited with p_locale=cs writes locale=cs');
SELECT set_config('ing.up_def', public.upsert_story_knowledge_item_audited(
     p_story_id := current_setting('ing.story')::uuid,
     p_title := 'default upsert', p_body_markdown := 'body')::text, true);
SELECT is(
  (SELECT locale FROM knowledge_items WHERE id = current_setting('ing.up_def')::uuid),
  'global',
  '(4b) upsert_story_knowledge_item_audited without p_locale defaults to global');
SELECT set_config('request.jwt.claims', NULL, true);

-- ════════════════════════════════════════════════════════════════════════════
-- (5) item locale FK fail-loud: an unregistered locale is rejected (23503)
-- ════════════════════════════════════════════════════════════════════════════
SELECT throws_ok($$
  INSERT INTO knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status, locale)
  VALUES (current_setting('ing.zz_item')::uuid, 'domain_doc', 'zz', 'b', NULL, 'public', 'active', 'zz')
$$, '23503', NULL, '(5) an unregistered item locale (zz) is rejected by the locale FK (23503)');
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

SELECT * FROM finish();
ROLLBACK;
