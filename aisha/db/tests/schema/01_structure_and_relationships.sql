-- pgTAP schema-contract tests — structure + enforced relationships
-- ============================================================================
-- Run by scripts/db/run-schema-tests.mjs against the APPLIED cold-start schema
-- (the in-DB complement of the catalog-based FK-relationship gate). This asserts
-- the invariants that MUST hold; the FK-gap allowlist tracks the ones that don't yet.
--
-- CREATE EXTENSION pgtap lives INSIDE the BEGIN…ROLLBACK so pgTAP's ~700 functions
-- never persist in the asserted schema. Add fk_ok() lines here as the FK-gap
-- inventory (src/tests/gates/fk-relationship-gaps.allowlist.json) is driven down.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(29);

-- ── Core tables exist ───────────────────────────────────────────────────────
SELECT has_table('public', 'profiles', 'core table: profiles');
SELECT has_table('public', 'partner_stories', 'core table: partner_stories');
SELECT has_table('public', 'partner_profiles', 'core table: partner_profiles');
SELECT has_table('public', 'story_entries', 'core table: story_entries');
SELECT has_table('public', 'audit_journal', 'core table: audit_journal');
SELECT has_table('public', 'chat_conversations', 'core table: chat_conversations');
SELECT has_table('public', 'chat_messages', 'core table: chat_messages');
SELECT has_table('public', 'knowledge_items', 'core table: knowledge_items');
SELECT has_table('public', 'expert_rules', 'core table: expert_rules');
SELECT has_table('public', 'ai_runs', 'core table: ai_runs');
SELECT has_table('public', 'member_health_documents', 'core table: member_health_documents');

-- ── Primary keys present ────────────────────────────────────────────────────
SELECT has_pk('public', 'partner_stories', 'pk: partner_stories');
SELECT has_pk('public', 'story_entries', 'pk: story_entries');
SELECT has_pk('public', 'profiles', 'pk: profiles');
SELECT has_pk('public', 'audit_journal', 'pk: audit_journal');

-- ── Critical columns ────────────────────────────────────────────────────────
SELECT has_column('public', 'story_entries', 'story_id', 'col: story_entries.story_id');
SELECT has_column('public', 'partner_stories', 'id', 'col: partner_stories.id');
SELECT has_column('public', 'audit_journal', 'action', 'col: audit_journal.action');

-- ── Enforced relationships (verified by the FK-relationship lens) ───────────
SELECT col_is_fk('public', 'story_entries', 'story_id', 'fk: story_entries.story_id is a foreign key');
SELECT col_is_fk('public', 'story_entries', 'parent_id', 'fk: story_entries.parent_id is a foreign key (self)');
SELECT col_is_fk('public', 'story_entries', 'document_id', 'fk: story_entries.document_id is a foreign key');
SELECT col_is_fk('public', 'story_ai_sessions', 'story_id', 'fk: story_ai_sessions.story_id is a foreign key');
SELECT col_is_fk('public', 'story_bundles', 'story_id', 'fk: story_bundles.story_id is a foreign key');
SELECT col_is_fk('public', 'story_labels', 'story_id', 'fk: story_labels.story_id is a foreign key');
SELECT fk_ok('public', 'story_entries', 'story_id', 'public', 'partner_stories', 'id', 'fk_ok: story_entries.story_id -> partner_stories.id');
SELECT fk_ok('public', 'story_entries', 'parent_id', 'public', 'story_entries', 'id', 'fk_ok: story_entries.parent_id -> story_entries.id');
SELECT fk_ok('public', 'story_entries', 'document_id', 'public', 'member_health_documents', 'id', 'fk_ok: story_entries.document_id -> member_health_documents.id');

-- ── Audience views (de-tenant invariant set) ────────────────────────────────
SELECT has_view('public', 'audience_actor_tier_v', 'view: audience_actor_tier_v');
SELECT has_view('public', 'audience_admin_signal_feed_v', 'view: audience_admin_signal_feed_v');

SELECT * FROM finish();
ROLLBACK;
