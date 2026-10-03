-- pgTAP acceptance — AISHA Omni · area: pat-tenancy
-- ============================================================================
-- Spec source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4)
--   §8   PAT delta: mcp_auth_tokens needs user_id FK + scope text[]
--   §8.5 BLOCKER:   scoped_to_story_id (bind-at-issuance, fail-closed)
--   §16/§20:        ai_runs.story_id NOT NULL invariant
--   §13/§47 ledger: validate_mcp_token must return {user_id, story_id, scoped_to_story_id}
--
-- ISOLATION: this file lives under aisha/db/tests/schema/omni/ — the default
-- runner scripts/db/run-schema-tests.mjs reads aisha/db/tests/schema/*.sql
-- NON-recursively (readdirSync, top-level only), so it is NOT picked up by a
-- normal run. It executes ONLY in acceptance mode (the omni acceptance runner
-- points at the omni/ subdir). Same BEGIN…ROLLBACK + CREATE EXTENSION pgtap
-- pattern as the sibling schema tests so pgTAP never persists.
--
-- LIVE vs SKIP: every surface asserted here EXISTS today (tables + functions),
-- so all assertions are LIVE. Several are INTENTIONALLY RED — they encode the
-- §8/§8.5/§16 contract that is not yet implemented and act as regression guards
-- that must flip green when the PAT story-binding migration lands.
--   RED today: mcp_auth_tokens.user_id, mcp_auth_tokens.scoped_to_story_id,
--              ai_runs.story_id NOT NULL.
--   GREEN today (positive surface-exists guards): mcp_auth_tokens table,
--              validate_mcp_token / create_mcp_token / get_chat_context_story_id fns.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- ── Positive: surfaces that EXIST today ─────────────────────────────────────
SELECT has_table('public', 'mcp_auth_tokens', 'positive: mcp_auth_tokens table exists (§8 anchor)');
SELECT has_column('public', 'mcp_auth_tokens', 'token_hash', 'positive: mcp_auth_tokens.token_hash (validate_mcp_token key)');
SELECT has_column('public', 'mcp_auth_tokens', 'scope', 'positive: mcp_auth_tokens.scope (scalar text today, §8 wants text[])');
SELECT has_column('public', 'mcp_auth_tokens', 'created_by', 'positive: mcp_auth_tokens.created_by (today keys on created_by, not user_id)');
SELECT has_function('public', 'validate_mcp_token', ARRAY['text','text','uuid'],
  'positive: validate_mcp_token(text,text,uuid) exists (LIVE surface)');
SELECT has_function('public', 'create_mcp_token',
  ARRAY['text','uuid','uuid','text[]','text[]','integer','integer','integer'],
  'positive: create_mcp_token(...) exists (bind-at-issuance target, §8.5)');
SELECT has_function('public', 'get_chat_context_story_id', ARRAY['uuid','uuid'],
  'positive: get_chat_context_story_id(uuid,uuid) exists (§19.1 resolver)');
SELECT has_column('public', 'ai_runs', 'story_id', 'positive: ai_runs.story_id column exists (§16 invariant carrier)');

-- ── False-positive guard: validate_mcp_token must NOT be PUBLIC-executable ──
-- §16 auth split: PAT validation is privileged; PUBLIC must not run it.
SELECT ok(
  NOT has_function_privilege('public', 'validate_mcp_token(text,text,uuid)', 'EXECUTE'),
  'false-positive guard: PUBLIC must NOT EXECUTE validate_mcp_token (revoked; only authenticated/service_role)'
);

-- ── Negative / fail-closed: created_by is NOT NULL (token always has an issuer) ──
-- A token with no issuer would break chargeback attribution; ensure the column is required.
SELECT col_not_null('public', 'mcp_auth_tokens', 'created_by',
  'negative/fail-closed: mcp_auth_tokens.created_by NOT NULL (every PAT has an issuer)');

-- ── LIVE-RED regression guards (§8 / §8.5 / §16) ────────────────────────────
-- These MUST FAIL today and flip GREEN when the PAT story-binding migration lands.

-- §8: PAT needs user_id FK (today it keys on account_id/project_id/created_by only).
SELECT has_column('public', 'mcp_auth_tokens', 'user_id',
  'LIVE-RED (§8): mcp_auth_tokens.user_id MUST exist (RED until migration)');

-- §8.5 BLOCKER: scoped_to_story_id, bind-at-issuance.
SELECT has_column('public', 'mcp_auth_tokens', 'scoped_to_story_id',
  'LIVE-RED (§8.5 BLOCKER): mcp_auth_tokens.scoped_to_story_id MUST exist (RED until migration)');

-- §8.5: scoped_to_story_id should FK to the story table (partner_stories) — bind-at-issuance integrity.
SELECT col_is_fk('public', 'mcp_auth_tokens', 'scoped_to_story_id',
  'LIVE-RED (§8.5): mcp_auth_tokens.scoped_to_story_id MUST be a FK (RED until migration)');

-- §16/§20: every run must carry a story → ai_runs.story_id NOT NULL.
SELECT col_not_null('public', 'ai_runs', 'story_id',
  'LIVE-RED (§16/§20): ai_runs.story_id MUST be NOT NULL (RED until §8.5 binding enforces it)');

SELECT * FROM finish();
ROLLBACK;
