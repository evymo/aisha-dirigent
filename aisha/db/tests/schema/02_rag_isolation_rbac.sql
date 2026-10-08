-- pgTAP schema-contract tests — RAG per-story isolation (RBAC + data-level)
-- ============================================================================
-- Runtime proof for the per-story knowledge_items isolation boundary. Every
-- function below is SECURITY DEFINER, so the knowledge_items RLS policy is
-- bypassed inside it — each must enforce isolation in its own body.
--
-- Two layers are asserted:
--   (1) RBAC guards (42501) on the story-scoped accessors:
--       (a) mcp_search_knowledge_v3 with a foreign p_story_id  → 42501
--       (b) compose_context with a non-participant p_requester_id → 42501
--       (c) owner / participant / admin succeed for both
--       (d) v3: a service-role call is not refused — keyed on the JWT role claim
--           (get_jwt_role()), session SET ROLE alone is still story-gated. Since 2026-10-05
--           a service call WITHOUT an audience reads global `public` items only (as in v2); story
--           items need p_audience_user_id with access — measured in the runtime tests;
--           compose_context: story-scoped call with NO resolvable requester
--           is fail-closed (42501) — hardened, no silent service-role bypass
--   (2) DATA-level isolation — seed a story-scoped item + a global item and prove
--       no foreign story content is ever returned by the FILTER-based paths the
--       guards do NOT cover:
--       (D1) v3 with p_story_id := NULL must NOT return story-scoped chunks
--            (the old `p_story_id IS NULL OR …` made the filter a no-op)
--       (D2) v3 as owner DOES return its own story's chunk (isolation ≠ lockout)
--       (D4) mcp_get_knowledge_item: anon caller cannot read a story item by id
--       (D5) mcp_get_knowledge_item: a participant CAN read its story item
--       (D6) mcp_get_knowledge_item: global items stay readable by anon
--   (mcp_search_knowledge_v2 called WITHOUT a story is measured per role in
--    src/tests/db/znalosti-cteni-povoleny-stav.runtime.test.ts. Until 2026-10-04 that
--    call could not be made at all: a 9-arg overload sat next to the 11-arg one and
--    every call without p_story_id was ambiguous. The 9-arg overload is gone.)
--
-- Identities/keys live in session GUCs (parametric: gen_random_uuid). JWT identity
-- is simulated via request.jwt.claims (read by auth.uid()/get_jwt_role()); the
-- service_role case also SET ROLEs so v3's session-role gate holds. Runs against
-- the APPLIED (unseeded) cold-start schema as superuser (fixtures bypass RLS).
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

-- ── Parametric identities, keys, and a 1536-dim query vector (session GUCs) ──
SELECT set_config('rbac.owner',        gen_random_uuid()::text, true);
SELECT set_config('rbac.participant',  gen_random_uuid()::text, true);
SELECT set_config('rbac.nonpart',      gen_random_uuid()::text, true);
SELECT set_config('rbac.admin',        gen_random_uuid()::text, true);
SELECT set_config('rbac.story',        gen_random_uuid()::text, true);
SELECT set_config('rbac.global_item',  gen_random_uuid()::text, true);
SELECT set_config('rbac.story_item',   gen_random_uuid()::text, true);
SELECT set_config('rbac.global_chunk', gen_random_uuid()::text, true);
SELECT set_config('rbac.story_chunk',  gen_random_uuid()::text, true);
-- Interní smlouva: story-scoped a PRIVATE — reálný tvar instančních dokumentů (naměřeno
-- 2026-07-30: všech 4 292 chunků leží pod private+story). Fixtury výš jsou
-- 'public', takže tenhle případ nikdy nereprodukovaly.
SELECT set_config('rbac.priv_item',   gen_random_uuid()::text, true);
SELECT set_config('rbac.priv_chunk',  gen_random_uuid()::text, true);
-- Non-zero 1536-dim vector ([1,0,…,0]); seeded as both the query and the chunk
-- embeddings so cosine similarity = 1 ⇒ matched items clear p_similarity_threshold.
-- Rozměr se NEDEKLARUJE — test si ho vezme ze SLOUPCE (pgvector nese dimenzi
-- v atttypmod). Napsaný natvrdo zastaral ve chvíli, kdy v1 prostor přešel
-- z cloudových 1536 na 1024 pro bge-m3, a sedm testů spadlo na fixtuře,
-- ne na testované vlastnosti.
SELECT set_config('rbac.qvec', '[1' || repeat(',0',
                        (SELECT atttypmod - 1 FROM pg_attribute
                        WHERE attrelid = 'knowledge_embeddings'::regclass
                          AND attname  = 'embedding')) || ']', true);

-- ── Principal + story fixtures ───────────────────────────────────────────────
-- Every principal the fixtures reference must EXIST: partner_stories.user_id and
-- story_participants.user_id are real foreign keys to aisha_auth.users now, so a
-- story can no longer be owned by a uuid nobody created. (Before the FK landed
-- this fixture quietly created a story for a non-existent owner.)
INSERT INTO aisha_auth.users (id) VALUES
  (current_setting('rbac.admin')::uuid),
  (current_setting('rbac.owner')::uuid),
  (current_setting('rbac.participant')::uuid)
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('rbac.admin')::uuid, 'admin'::app_role);
INSERT INTO partner_stories (id, user_id, title)
  VALUES (current_setting('rbac.story')::uuid, current_setting('rbac.owner')::uuid,
          'RBAC isolation test story');
INSERT INTO story_participants (story_id, user_id, role)
  VALUES (current_setting('rbac.story')::uuid, current_setting('rbac.participant')::uuid,
          'member');
INSERT INTO context_profiles (slug, display_name, layers)
  VALUES ('__rbac_isolation_test__', 'RBAC isolation test', '{}'::jsonb);

-- The knowledge layer carries locale NOT NULL DEFAULT 'global' (Brick3) with an
-- FK → supported_languages.code. This suite runs against the APPLIED (UNSEEDED)
-- schema, so the 'global' sentinel must be inserted before any knowledge_* row
-- or the locale FK 23503-fails. ON CONFLICT keeps it idempotent across reruns.
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('global', 'Global', 'languages.global.name', true, false, 0)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

-- ── KB fixtures: one GLOBAL item (story_id NULL) and one STORY-scoped item ────
-- Both visibility='public' (the real per-story default) so the test reproduces
-- the actual leak conditions. User triggers disabled so the AFTER INSERT
-- embedding-queue / ragnarok-sync hooks don't fire on fixtures (FK checks stay on).
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
INSERT INTO knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status)
VALUES
  (current_setting('rbac.global_item')::uuid, 'domain_doc', 'RBAC global doc', 'global body',
   NULL, 'public', 'active'),
  (current_setting('rbac.story_item')::uuid, 'domain_doc', 'RBAC story doc', 'secret story body',
   current_setting('rbac.story')::uuid, 'public', 'active');
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
VALUES
  (current_setting('rbac.global_chunk')::uuid, current_setting('rbac.global_item')::uuid, 0, 'global chunk text'),
  (current_setting('rbac.story_chunk')::uuid,  current_setting('rbac.story_item')::uuid,  0, 'secret story chunk text');

-- Private smluvní dokument + jeho znění. Hledané slovo ('výpovědní') je JEN
-- v těle chunku, ne v nadpisu ani shrnutí — kdyby test procházel přes title,
-- prošel by ze špatného důvodu. Diakritika je tam schválně: norm_text ji skládá.
ALTER TABLE public.knowledge_items DISABLE TRIGGER USER;
INSERT INTO knowledge_items (id, item_type, title, body_markdown, story_id, visibility, status)
VALUES
  (current_setting('rbac.priv_item')::uuid, 'domain_doc', 'RBAC private contract', 'telo',
   current_setting('rbac.story')::uuid, 'private', 'active');
ALTER TABLE public.knowledge_items ENABLE TRIGGER USER;

INSERT INTO knowledge_chunks (id, knowledge_item_id, chunk_index, chunk_text)
VALUES
  (current_setting('rbac.priv_chunk')::uuid, current_setting('rbac.priv_item')::uuid, 0,
   'ujednání o výpovědní lhůtě tři měsíce');

INSERT INTO knowledge_embeddings (chunk_id, knowledge_item_id, embedding)
VALUES
  (current_setting('rbac.global_chunk')::uuid, current_setting('rbac.global_item')::uuid, current_setting('rbac.qvec')::vector),
  (current_setting('rbac.story_chunk')::uuid,  current_setting('rbac.story_item')::uuid,  current_setting('rbac.qvec')::vector);

-- A multimodal PDF page on the STORY-scoped item (a user-upload PII vector). Its policy
-- gates on an EXISTS over knowledge_items — which is itself RLS-filtered — so it must
-- inherit the parent's per-story isolation (see D10). Triggers off so the embedding-queue
-- hook doesn't fire on the fixture.
ALTER TABLE public.knowledge_multimodal_pages DISABLE TRIGGER USER;
INSERT INTO knowledge_multimodal_pages (knowledge_item_id, page_number)
  VALUES (current_setting('rbac.story_item')::uuid, 1);
ALTER TABLE public.knowledge_multimodal_pages ENABLE TRIGGER USER;

-- ── Structural: requester-scoped signature replaced the unguarded one ─────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'compose_context' AND p.pronargs = 6
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'compose_context' AND p.pronargs = 5
  ),
  'compose_context: 6-arg requester-scoped signature exists and legacy 5-arg is dropped'
);

-- ════════════════════════════════════════════════════════════════════════════
-- (1) RBAC guards — mcp_search_knowledge_v3
-- ════════════════════════════════════════════════════════════════════════════

-- (a) non-participant authenticated, foreign story → 42501
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.nonpart'), 'role', 'authenticated')::text, true);
SELECT throws_ok(
  $rbac$ SELECT * FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('rbac.qvec')::vector,
            p_story_id := current_setting('rbac.story')::uuid, p_model_pref := 'v1') $rbac$,
  '42501', NULL, '(a) v3: non-participant with foreign p_story_id is denied (42501)');

-- (c) owner / participant / admin allowed
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.owner'), 'role', 'authenticated')::text, true);
SELECT lives_ok(
  $rbac$ SELECT * FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('rbac.qvec')::vector,
            p_story_id := current_setting('rbac.story')::uuid, p_model_pref := 'v1') $rbac$,
  '(c) v3: story owner is allowed');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.participant'), 'role', 'authenticated')::text, true);
SELECT lives_ok(
  $rbac$ SELECT * FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('rbac.qvec')::vector,
            p_story_id := current_setting('rbac.story')::uuid, p_model_pref := 'v1') $rbac$,
  '(c) v3: story participant is allowed');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.admin'), 'role', 'authenticated')::text, true);
SELECT lives_ok(
  $rbac$ SELECT * FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('rbac.qvec')::vector,
            p_story_id := current_setting('rbac.story')::uuid, p_model_pref := 'v1') $rbac$,
  '(c) v3: admin/staff is allowed');

-- (d) service_role (JWT role + session role): the call is not refused; the DATA scope is the audience's
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET ROLE service_role;
SELECT lives_ok(
  $rbac$ SELECT * FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('rbac.qvec')::vector,
            p_story_id := current_setting('rbac.story')::uuid, p_model_pref := 'v1') $rbac$,
  '(d) v3: service_role call with a story is not refused');
RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) RBAC guards — compose_context (requester guard, independent of JWT/role)
-- ════════════════════════════════════════════════════════════════════════════
SELECT throws_ok(
  $rbac$ SELECT compose_context(
            p_story_id := current_setting('rbac.story')::uuid,
            p_context_profile_slug := '__rbac_isolation_test__',
            p_requester_id := current_setting('rbac.nonpart')::uuid) $rbac$,
  '42501', NULL, '(b) compose_context: non-participant p_requester_id is denied (42501)');
SELECT lives_ok(
  $rbac$ SELECT compose_context(p_story_id := current_setting('rbac.story')::uuid,
            p_context_profile_slug := '__rbac_isolation_test__',
            p_requester_id := current_setting('rbac.owner')::uuid) $rbac$,
  '(c) compose_context: story owner requester is allowed');
SELECT lives_ok(
  $rbac$ SELECT compose_context(p_story_id := current_setting('rbac.story')::uuid,
            p_context_profile_slug := '__rbac_isolation_test__',
            p_requester_id := current_setting('rbac.participant')::uuid) $rbac$,
  '(c) compose_context: story participant requester is allowed');
SELECT lives_ok(
  $rbac$ SELECT compose_context(p_story_id := current_setting('rbac.story')::uuid,
            p_context_profile_slug := '__rbac_isolation_test__',
            p_requester_id := current_setting('rbac.admin')::uuid) $rbac$,
  '(c) compose_context: admin/staff requester is allowed');
-- (d) Story-scoped compose_context with NO resolvable requester is REFUSED.
-- The guard was hardened: a NULL identity on a story-scoped call is fail-closed —
-- a genuine background job must pass an explicit system principal as p_requester_id
-- rather than rely on a silent service-role bypass. Here p_requester_id is omitted
-- and the session carries no sub claim, so auth.uid() is NULL → refused.
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SELECT throws_ok(
  $rbac$ SELECT compose_context(p_story_id := current_setting('rbac.story')::uuid,
            p_context_profile_slug := '__rbac_isolation_test__') $rbac$,
  '42501', NULL,
  '(d) compose_context: story-scoped call with no requester identity is refused (42501)');

-- ════════════════════════════════════════════════════════════════════════════
-- (2) DATA-level isolation — prove no foreign story content is returned
-- ════════════════════════════════════════════════════════════════════════════

-- (D1) v3 with p_story_id := NULL (guard does NOT fire) must NOT leak the
--      story-scoped chunk — the core residual leak the guard alone left open.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.nonpart'), 'role', 'authenticated')::text, true);
SELECT is_empty(
  $rbac$ SELECT knowledge_item_id FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('rbac.qvec')::vector,
            p_story_id := NULL, p_model_pref := 'v1')
         WHERE knowledge_item_id = current_setting('rbac.story_item')::uuid $rbac$,
  '(D1) v3 with NULL p_story_id does NOT return any story-scoped chunk');

-- (D2) …but the story OWNER querying its own story DOES get the chunk back
--      (isolation must not become a lockout).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.owner'), 'role', 'authenticated')::text, true);
SELECT isnt_empty(
  $rbac$ SELECT knowledge_item_id FROM mcp_search_knowledge_v3(
            p_query_embedding_v1 := current_setting('rbac.qvec')::vector,
            p_story_id := current_setting('rbac.story')::uuid, p_model_pref := 'v1')
         WHERE knowledge_item_id = current_setting('rbac.story_item')::uuid $rbac$,
  '(D2) v3 returns the story chunk to the owner (isolation is not a lockout)');

-- (D4) mcp_get_knowledge_item: an anon caller (no identity — the same as a service-role
--      call WITHOUT an audience) cannot fetch a story-scoped item by id.
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
SELECT is(
  (SELECT mcp_get_knowledge_item(p_item_id := current_setting('rbac.story_item')::uuid)),
  NULL,
  '(D4) mcp_get_knowledge_item: anon cannot read a story-scoped item by id');

-- (D5) …but a participant CAN fetch its own story item.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.participant'), 'role', 'authenticated')::text, true);
SELECT isnt(
  (SELECT mcp_get_knowledge_item(p_item_id := current_setting('rbac.story_item')::uuid)),
  NULL,
  '(D5) mcp_get_knowledge_item: a story participant can read its story item');

-- (D6) …and global items stay readable by anon (no over-blocking).
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
SELECT isnt(
  (SELECT mcp_get_knowledge_item(p_item_id := current_setting('rbac.global_item')::uuid)),
  NULL,
  '(D6) mcp_get_knowledge_item: global items remain readable by anon');

-- ════════════════════════════════════════════════════════════════════════════
-- (3) DIRECT-TABLE RLS isolation — the leak the SECURITY DEFINER functions hide.
--     The accessors above are SECURITY DEFINER + guarded, but PostgREST also exposes
--     the base tables: a raw `SELECT FROM knowledge_items` runs under RLS as the
--     caller's role. The "Anyone can read active public knowledge items" policy gated
--     ONLY on (status, visibility) — NOT story_id — and visibility DEFAULTs to 'public',
--     so a story-scoped (user-uploaded) item was world-readable by ANY authenticated
--     user via the table API. These prove the policy is gated on story_id IS NULL:
--     only GLOBAL/curated knowledge may be public; story-scoped content is isolated.
--     (SET ROLE → the role is non-BYPASSRLS, so RLS actually applies; auth.uid() reads
--      the request.jwt.claims 'sub' set above.)

-- (D7) RED-until-fix: foreign authenticated must NOT read a story-scoped item directly.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.nonpart'), 'role', 'authenticated')::text, true);
SET ROLE authenticated;
SELECT is_empty(
  $rbac$ SELECT id FROM public.knowledge_items WHERE id = current_setting('rbac.story_item')::uuid $rbac$,
  '(D7) RLS direct: foreign authenticated cannot read a story-scoped item via raw SELECT');
RESET ROLE;

-- (D8) …a GLOBAL public item stays readable by any authenticated user (not over-blocked).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.nonpart'), 'role', 'authenticated')::text, true);
SET ROLE authenticated;
SELECT isnt_empty(
  $rbac$ SELECT id FROM public.knowledge_items WHERE id = current_setting('rbac.global_item')::uuid $rbac$,
  '(D8) RLS direct: a global public item remains readable by any authenticated user');
RESET ROLE;

-- (D9) …and the story OWNER reads its own story item directly (isolation ≠ lockout).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.owner'), 'role', 'authenticated')::text, true);
SET ROLE authenticated;
SELECT isnt_empty(
  $rbac$ SELECT id FROM public.knowledge_items WHERE id = current_setting('rbac.story_item')::uuid $rbac$,
  '(D9) RLS direct: the story owner reads its own story item (per-story policy)');
RESET ROLE;

-- (D10) multimodal pages inherit the parent item's isolation: the "kmm pages follow
--       parent visibility" policy gates on EXISTS over knowledge_items, which is itself
--       RLS-filtered, so a foreign authenticated caller cannot read a story-scoped page
--       once the items public-read policy is story_id-gated (cascade, no separate fix).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.nonpart'), 'role', 'authenticated')::text, true);
SET ROLE authenticated;
SELECT is_empty(
  $rbac$ SELECT id FROM public.knowledge_multimodal_pages WHERE knowledge_item_id = current_setting('rbac.story_item')::uuid $rbac$,
  '(D10) RLS direct: foreign authenticated cannot read a story-scoped multimodal page (cascades items RLS)');
RESET ROLE;

-- ── (D11–D13) Lexikální retrieval nad ZNĚNÍM private smlouvy ─────────────────
-- Do 2026-07-30 vracela tahle cesta vždy prázdno, ze tří nezávislých příčin:
-- (a) 0 embeddingů, (b) lexikální větev hledala jen v title/summary,
-- (c) paušál `visibility IN (public, members, guild)` — PŘÍSNĚJŠÍ než RLS
-- politika „Per-story KB visible to participants", která o visibility nemluví.
-- Testuje se bez vektoru (p_query_embedding NULL) právě proto, aby se měřila
-- lexikální dráha samotná.
--
-- Volá se všemi 11 argumenty (příběh + publikum). Do 2026-10-04 to byla i jediná cesta:
-- vedle existovalo 9argumentové přetížení a kratší volání bylo nejednoznačné.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rbac.owner'), 'role', 'service_role')::text, true);
SET LOCAL ROLE service_role;

SELECT isnt_empty(
  $rbac$ SELECT jsonb_array_elements(public.mcp_search_knowledge_v2(
    NULL::vector, 'výpovědní'::text, '{}'::text[], NULL::text, NULL::text, '{}'::text[],
    true, 10, 0.3,
    current_setting('rbac.story')::uuid, current_setting('rbac.owner')::uuid)) $rbac$,
  '(D11) vlastník story NAJDE private smlouvu podle slova z jejího ZNĚNÍ');

SELECT is_empty(
  $rbac$ SELECT jsonb_array_elements(public.mcp_search_knowledge_v2(
    NULL::vector, 'výpovědní'::text, '{}'::text[], NULL::text, NULL::text, '{}'::text[],
    true, 10, 0.3,
    current_setting('rbac.story')::uuid, current_setting('rbac.nonpart')::uuid)) $rbac$,
  '(D12) cizí uživatel NEDOSTANE nic — izolace je per člověk × story, ne per role');

-- Měřidlo měřidla: kdyby slovo bylo i v nadpisu, prošlo by D11 i bez opravy.
SELECT is_empty(
  $rbac$ SELECT 1 FROM public.knowledge_items ki
         WHERE ki.id = current_setting('rbac.priv_item')::uuid
           AND public.norm_text(coalesce(ki.title,'') || ' ' || coalesce(ki.summary,''))
               LIKE '%vypovedni%' $rbac$,
  '(D13) hledané slovo NENÍ v nadpisu ani shrnutí — D11 může projít jen přes chunk_text');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
