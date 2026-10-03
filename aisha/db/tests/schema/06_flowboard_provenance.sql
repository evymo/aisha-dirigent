-- pgTAP schema-contract tests — Flowboard runtime provenance writes
-- ============================================================================
-- The flowboard sandbox executor (services/svc-ai-chat/src/lib/flowboardSandboxExecutor.ts)
-- persists a run's provenance into StoryLoop via create_story_entry_audited under the
-- USER's JWT: a `flow_run` umbrella, one `automation_step` per node, and a
-- `consent_request` when a gate.consent halts the run.
--
-- This proves the DB CONTRACT the executor depends on, against the real RPC:
--   (1) create_story_entry_audited accepts the flowboard entry_types (flow_run /
--       automation_step / consent_request) — entry_type is open text, no allowlist.
--   (2) A flow owner runs in their OWN story as owner_mode='member', and the RPC
--       FORBIDS members from creating INTERNAL entries (RAISE 42501). This is exactly
--       why the executor writes every entry as is_internal=false — a regression to
--       is_internal=true would fail the run mid-execution. (4) locks that contract in.
--
-- Runs against the APPLIED (unseeded) cold-start schema as superuser; fixtures use
-- session_replication_role=replica to bypass FK/triggers; JWT identity is simulated
-- via request.jwt.claims (auth.uid() = sub claim), and the caller is NOT a partner so
-- get_current_partner_id() returns NULL → owner_mode='member'.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- ── Identities ───────────────────────────────────────────────────────────────
SELECT set_config('fp.user',    gen_random_uuid()::text, true);
SELECT set_config('fp.partner', gen_random_uuid()::text, true);  -- the story's partner (caller is NOT this partner)
SELECT set_config('fp.story',   gen_random_uuid()::text, true);

-- ── Fixtures (FK/triggers off) ───────────────────────────────────────────────
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES (current_setting('fp.user')::uuid);
-- A story the user owns. partner_id is NON-NULL (the access check treats a NULL
-- partner_id as 'Story not found'); the caller has no partner context, so they land
-- in owner_mode='member'.
INSERT INTO partner_stories (id, partner_id, user_id, title)
  VALUES (current_setting('fp.story')::uuid, current_setting('fp.partner')::uuid,
          current_setting('fp.user')::uuid, 'Flowboard run story');
-- Stay in replica mode for the RPC calls: the story's partner_id is synthetic (there is
-- no real partners row), and create_story_entry_audited touches partner_stories — which
-- re-validates that FK in origin mode. We are asserting the auth + entry-type + is_internal
-- contract, not the FK, so replica (FK/triggers off) is the faithful seam here. auth.uid()
-- reads request.jwt.claims and is unaffected by session_replication_role.

-- ── Authenticate as the flow owner (member-mode: no partner claim) ───────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fp.user'), 'role', 'authenticated')::text, true);

-- (1) flow_run umbrella entry persists (non-internal) → returns a non-null id
SELECT isnt(
  create_story_entry_audited(
    current_setting('fp.story')::uuid, 'flow_run', 'Automatizace spuštěna.',
    '{"flowboard":{"kind":"flow_run","icon":"play"}}'::jsonb, false),
  NULL, '(1) create_story_entry_audited accepts a non-internal flow_run entry');

-- (2) automation_step entry persists (non-internal)
SELECT isnt(
  create_story_entry_audited(
    current_setting('fp.story')::uuid, 'automation_step', 'Krok — executed',
    '{"flowboard":{"kind":"automation_step","status":"executed","icon":"bot"}}'::jsonb, false),
  NULL, '(2) create_story_entry_audited accepts a non-internal automation_step entry');

-- (3) consent_request entry persists (non-internal, user-facing)
SELECT isnt(
  create_story_entry_audited(
    current_setting('fp.story')::uuid, 'consent_request', 'Čeká na schválení.',
    '{"flowboard":{"kind":"consent_request","status":"awaiting_approval","icon":"lock"}}'::jsonb, false),
  NULL, '(3) create_story_entry_audited accepts a non-internal consent_request entry');

-- (4) the member-internal contract — an internal entry from a member-mode owner is DENIED.
--     This is the regression guard for the executor's is_internal=false choice.
SELECT throws_ok(
  $fp$ SELECT create_story_entry_audited(
    current_setting('fp.story')::uuid, 'automation_step', 'internal',
    '{}'::jsonb, true) $fp$,
  '42501', NULL,
  '(4) a member-mode owner CANNOT create an internal entry (42501) — why the executor uses is_internal=false');

SELECT * FROM finish();
ROLLBACK;
