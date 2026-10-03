-- pgTAP schema-contract tests — Brick6 tier-ACL (v3)
-- ============================================================================
-- knowledge_items.minimum_tier gates retrieval by the requesting user's audience tier.
-- audience_user_meets_tier_requirement(text, uuid) derives the user's tier via the
-- UNGUARDED audience_compute_actor_tier (a boolean gate, no stats), fails CLOSED, and
-- admin/staff meet every tier. mcp_search_knowledge_v3 applies it as a HARD WHERE filter
-- against p_audience_user_id (which only service_role may set; authenticated callers are
-- pinned to auth.uid()). Proven here: schema, fail-closed, derive (partner vs registered),
-- and v3 deny/allow. Runs UNSEEDED in a rolled-back txn.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('global','Global','languages.global.name',true,false,0)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

SELECT set_config('t.partner', gen_random_uuid()::text, true);
SELECT set_config('t.reg',     gen_random_uuid()::text, true);
SELECT set_config('t.gated',   gen_random_uuid()::text, true);
SELECT set_config('t.open',    gen_random_uuid()::text, true);
-- Rozměr se NEDEKLARUJE — test si ho vezme ze SLOUPCE (pgvector nese dimenzi
-- v atttypmod). Napsaný natvrdo zastaral ve chvíli, kdy v1 prostor přešel
-- z cloudových 1536 na 1024 pro bge-m3, a sedm testů spadlo na fixtuře,
-- ne na testované vlastnosti.
SELECT set_config('t.qvec', '[1' || repeat(',0',
                        (SELECT atttypmod - 1 FROM pg_attribute
                        WHERE attrelid = 'knowledge_embeddings'::regclass
                          AND attname  = 'embedding')) || ']', true);

-- A partner-tier user (profiles + partner_profiles is_visible+is_production_provider) and a
-- registered-tier user (profiles only).
INSERT INTO aisha_auth.users (id)
  VALUES (current_setting('t.partner')::uuid), (current_setting('t.reg')::uuid);
INSERT INTO profiles (user_id)
  VALUES (current_setting('t.partner')::uuid), (current_setting('t.reg')::uuid)
  ON CONFLICT (user_id) DO NOTHING;
INSERT INTO partner_profiles (user_id, display_name, city, is_visible, is_production_provider)
  VALUES (current_setting('t.partner')::uuid, 'Partner', 'City', true, true);

-- A partner-gated item and an ungated item, each with a chunk + embedding. Triggers off so the
-- embedding-queue hook does not fire; source_concept_id set explicitly.
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
INSERT INTO knowledge_items (id, item_type, source_type, source_concept_id, locale, minimum_tier, title, body_markdown, status, visibility, version) VALUES
  (current_setting('t.gated')::uuid, 'domain_doc','manual', current_setting('t.gated')::uuid, 'global', 'partner', 'gated','b','active','public',1),
  (current_setting('t.open')::uuid,  'domain_doc','manual', current_setting('t.open')::uuid,  'global', NULL,      'open', 'b','active','public',1);
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;
INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text, locale) VALUES
  (current_setting('t.gated')::uuid, current_setting('t.gated')::uuid, 0, 'g', 'global'),
  (current_setting('t.open')::uuid,  current_setting('t.open')::uuid,  0, 'o', 'global');
INSERT INTO knowledge_embeddings (chunk_id, knowledge_item_id, embedding) VALUES
  (current_setting('t.gated')::uuid, current_setting('t.gated')::uuid, current_setting('t.qvec')::vector),
  (current_setting('t.open')::uuid,  current_setting('t.open')::uuid,  current_setting('t.qvec')::vector);

SELECT has_column('public','knowledge_items','minimum_tier', '(1) knowledge_items.minimum_tier column exists');
SELECT has_function('public','audience_user_meets_tier_requirement', ARRAY['text','uuid'],
  '(2) the 2-arg tier-ACL function exists');

SELECT is(public.audience_user_meets_tier_requirement('partner', NULL), false,
  '(3) a NULL user fails CLOSED — does not meet partner');
SELECT is(public.audience_user_meets_tier_requirement('partner', current_setting('t.partner')::uuid), true,
  '(4) a partner-tier user meets the partner requirement');
SELECT is(public.audience_user_meets_tier_requirement('partner', current_setting('t.reg')::uuid), false,
  '(5) a registered user does NOT meet the partner requirement');

-- v3's audience-user override uses get_jwt_role() (the JWT claim) to identify a trusted
-- service caller, while its auth check uses the session role — set BOTH so the override
-- honours p_audience_user_id (mirrors prod: a service_role JWT + PostgREST SET ROLE).
SELECT set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int FROM mcp_search_knowledge_v3(
     p_query_embedding_v1 := current_setting('t.qvec')::vector, p_model_pref := 'v1', p_similarity_threshold := 0, p_limit := 50,
     p_audience_user_id := current_setting('t.reg')::uuid)
   WHERE knowledge_item_id = current_setting('t.gated')::uuid),
  0, '(6) v3 EXCLUDES a partner-gated item from a registered user (HARD deny)');
SELECT is(
  (SELECT count(*)::int FROM mcp_search_knowledge_v3(
     p_query_embedding_v1 := current_setting('t.qvec')::vector, p_model_pref := 'v1', p_similarity_threshold := 0, p_limit := 50,
     p_audience_user_id := current_setting('t.partner')::uuid)
   WHERE knowledge_item_id = current_setting('t.gated')::uuid),
  1, '(7) v3 RETURNS the partner-gated item to a partner-tier user');

SELECT * FROM finish();
ROLLBACK;
