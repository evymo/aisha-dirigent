-- pgTAP acceptance — area: story-resolver-hole (§19.1, §16, §20)
-- ============================================================================
-- Source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4).
--
-- ISOLATION: this file lives under aisha/db/tests/schema/omni/ which the default
-- pgTAP runner (scripts/db/run-schema-tests.mjs) does NOT pick up — it reads the
-- TOP-LEVEL aisha/db/tests/schema/*.sql flat (readdirSync, non-recursive). So
-- this acceptance file never runs in the cold-start gate; it is executed ONLY in
-- Omni acceptance mode (a runner pointed at this subdir). Like every schema test
-- it is wrapped BEGIN…ROLLBACK and CREATE EXTENSION pgtap, so it never persists.
--
-- AREA CONTRACT — the resolver cross-tenant hole, asserted IN-DB against the
-- SECURITY DEFINER function public.get_chat_context_story_id(p_story_id, p_user_id)
-- (aisha/db/sql/functions/get_chat_context_story_id.sql):
--
--   POSITIVE        — owner's own explicit p_story_id resolves to that story.
--   NEGATIVE (RED)  — a foreign explicit p_story_id is returned to a non-owner.
--                     The fn only checks EXISTS(partner_stories.id=p_story_id)
--                     (:20), NOT ownership → cross-tenant leak. Expected-RED:
--                     this assertion FAILS today (regression guard) and flips
--                     GREEN once ownership (partner_stories.user_id / a
--                     story_participants row) is enforced.
--   FALSE-POS (RED) — for a user who owns NOTHING and passes NULL p_story_id,
--                     the unscoped fallback (:42-:50, `WHERE ps.status='active'`
--                     with no user filter) returns an ARBITRARY active story.
--                     The resolver MUST fail-closed (NULL). Expected-RED today.
--
--   INVARIANT (RED) — §19.1 / §20 P0 #5: ai_runs.story_id MUST become NOT NULL
--                     (carries RLS/chargeback/governance/audit). Today the column
--                     is nullable (aisha/db/sql/tables/ai_runs.sql:7). Expected-RED.
--
-- Identities are parametric session GUCs (gen_random_uuid), mirroring
-- aisha/db/tests/schema/02_rag_isolation_rbac.sql. Two tenants: A owns story A,
-- B owns nothing. Runs as superuser against the APPLIED (unseeded) schema;
-- fixtures bypass RLS, the fn is SECURITY DEFINER and reads p_user_id from arg.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

-- ── Parametric identities ────────────────────────────────────────────────────
SELECT set_config('srh.tenant_a', gen_random_uuid()::text, true);
SELECT set_config('srh.tenant_b', gen_random_uuid()::text, true);
SELECT set_config('srh.story_a',  gen_random_uuid()::text, true);

-- ── Fixtures: tenant A owns an ACTIVE story; tenant B owns / participates in
--    NOTHING (so the owner-scoped SELECT for B returns NULL and control falls
--    into the arbitrary-active fallback). FK-safe principals. ────────────────
INSERT INTO aisha_auth.users (id) VALUES (current_setting('srh.tenant_a')::uuid)
  ON CONFLICT DO NOTHING;
INSERT INTO aisha_auth.users (id) VALUES (current_setting('srh.tenant_b')::uuid)
  ON CONFLICT DO NOTHING;
INSERT INTO partner_stories (id, user_id, title, status)
  VALUES (current_setting('srh.story_a')::uuid, current_setting('srh.tenant_a')::uuid,
          'omni-acceptance story-resolver tenant-A story', 'active');
INSERT INTO story_participants (story_id, user_id, role)
  VALUES (current_setting('srh.story_a')::uuid, current_setting('srh.tenant_a')::uuid, 'owner');

-- ── Structural: the resolver function exists with the (uuid, uuid) signature ──
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_chat_context_story_id'
      AND p.pronargs = 2
  ),
  'structural: get_chat_context_story_id(p_story_id uuid, p_user_id uuid) exists'
);

-- ════════════════════════════════════════════════════════════════════════════
-- POSITIVE — owner's own explicit story resolves to itself.
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  public.get_chat_context_story_id(
    current_setting('srh.story_a')::uuid,
    current_setting('srh.tenant_a')::uuid
  ),
  current_setting('srh.story_a')::uuid,
  'POSITIVE: owner passing own p_story_id resolves to that story'
);

-- ════════════════════════════════════════════════════════════════════════════
-- NEGATIVE (expected-RED) — a foreign explicit p_story_id must NOT be returned
-- to a non-owner. Today the fn returns story_a to tenant B (existence-only check
-- at :20) → this assertion FAILS now, pinning the cross-tenant hole; it flips
-- GREEN when ownership is enforced (returns NULL or raises 42501).
-- regtest: regtest-story-resolver-ownership / sec-resolver-ownership-negative.
-- ════════════════════════════════════════════════════════════════════════════
SELECT isnt(
  public.get_chat_context_story_id(
    current_setting('srh.story_a')::uuid,   -- owned by tenant A
    current_setting('srh.tenant_b')::uuid   -- tenant B is NOT a participant
  ),
  current_setting('srh.story_a')::uuid,
  'NEGATIVE (expected-RED): foreign p_story_id must NOT resolve for a non-owner'
);

-- ════════════════════════════════════════════════════════════════════════════
-- FALSE-POSITIVE (expected-RED) — a story-less user passing NULL p_story_id must
-- NOT receive an arbitrary active story. Today the unscoped fallback (:42-:50)
-- returns tenant A's story to tenant B → FAILS now; flips GREEN when the
-- arbitrary-active fallback is removed (resolver returns NULL = fail-closed).
-- sec-resolver-ownership-false-positive (BUG B).
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  public.get_chat_context_story_id(
    NULL::uuid,
    current_setting('srh.tenant_b')::uuid   -- owns nothing, participates in nothing
  ),
  NULL::uuid,
  'FALSE-POSITIVE (expected-RED): NULL story + story-less user must fail-closed (NULL), not leak an arbitrary active story'
);

-- Cross-check the false-positive is specifically the LEAK (not some other story):
-- the value returned today is exactly tenant A's story. Asserting it is NULL
-- above is the real contract; this isnt() makes the leak self-documenting.
SELECT isnt(
  public.get_chat_context_story_id(
    NULL::uuid,
    current_setting('srh.tenant_b')::uuid
  ),
  current_setting('srh.story_a')::uuid,
  'FALSE-POSITIVE (expected-RED): the arbitrary-active fallback must NOT return tenant A''s story to tenant B'
);

-- ════════════════════════════════════════════════════════════════════════════
-- INVARIANT (expected-RED) — §19.1 / §20 P0 #5: ai_runs.story_id MUST be NOT NULL
-- so every run carries a story for RLS/chargeback/governance/audit. Today the
-- column is nullable → FAILS now; flips GREEN when the NOT NULL constraint lands.
-- ════════════════════════════════════════════════════════════════════════════
SELECT col_not_null(
  'public', 'ai_runs', 'story_id',
  'INVARIANT (expected-RED): ai_runs.story_id is NOT NULL'
);

SELECT finish();
ROLLBACK;
