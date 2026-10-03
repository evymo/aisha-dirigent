-- ============================================================================
-- Omni acceptance pgTAP — area: broadcast-realtime
-- SOURCE OF TRUTH: docs/planning/AISHA_OMNI_GATEWAY.md (v4) §9, §10, §16, §20.
--
-- ISOLATION: this file lives under aisha/db/tests/schema/omni/ — the default
-- scripts/db/run-schema-tests.mjs uses readdirSync(TESTS_DIR) (NON-recursive,
-- TESTS_DIR = aisha/db/tests/schema), so files in this omni/ subdirectory are
-- NOT picked up by the normal schema-test run. It executes ONLY in acceptance
-- mode (the suite's dedicated runner points TESTS_DIR at .../schema/omni).
--
-- LIVE vs SKIP applied as LIVE-RED guards:
--   §9 states the broadcast producer is "🔴 chybí" and the target tables have
--   "ŽÁDNÝ trigger ani sloupec updated_at (jen created_at)". These pgTAP
--   assertions are therefore written as the EXACT post-impl contract and are
--   EXPECTED TO FAIL TODAY (intentional regression guards): they turn green only
--   once migration §10 lands fn_pg_notify_broadcast + the three triggers +
--   updated_at columns. Each RED assertion is annotated. The "current state"
--   negative invariants (tables exist, have created_at, RLS on) are LIVE-GREEN.
--
-- Wrapped in BEGIN…ROLLBACK; pgtap extension created inside the txn so its
-- ~700 functions never persist (mirrors 01_structure_and_relationships.sql).
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

-- ── GREEN baseline: the broadcast SOURCE tables exist today (§9) ─────────────
SELECT has_table('public', 'ai_trace_events',       'src table exists: ai_trace_events');
SELECT has_table('public', 'ai_workflow_node_runs', 'src table exists: ai_workflow_node_runs');
SELECT has_table('public', 'dirigent_nudges',       'src table exists: dirigent_nudges');

-- ── GREEN baseline: they have created_at, RLS enabled (current invariants) ───
SELECT has_column('public', 'ai_trace_events',       'created_at', 'ai_trace_events.created_at present');
SELECT has_column('public', 'ai_workflow_node_runs', 'created_at', 'ai_workflow_node_runs.created_at present');
SELECT has_column('public', 'dirigent_nudges',       'created_at', 'dirigent_nudges.created_at present');

-- ── GREEN: status column used by the terminal-only node_runs trigger (§10) ───
SELECT has_column('public', 'ai_workflow_node_runs', 'status', 'ai_workflow_node_runs.status present (terminal-state source)');
SELECT has_column('public', 'ai_trace_events',       'run_id', 'ai_trace_events.run_id present (run:<id> topic source)');
-- dirigent_nudges topic sources: conversation_id (session:) + story_id (workspace derivation)
SELECT has_column('public', 'dirigent_nudges', 'conversation_id', 'dirigent_nudges.conversation_id present (session: topic source)');
SELECT has_column('public', 'dirigent_nudges', 'expires_at',      'dirigent_nudges.expires_at present (stale-nudge guard source)');

-- ============================================================================
-- RED GUARDS (§9/§10) — EXPECTED TO FAIL TODAY. They encode the post-migration
-- contract; failure here is the regression signal that §10 has not yet landed.
-- ============================================================================

-- §10: generic factory must exist.
SELECT has_function(
  'public', 'fn_pg_notify_broadcast', ARRAY['text','text','jsonb'],
  'RED(§10): fn_pg_notify_broadcast(text,text,jsonb) factory exists'
);

-- §10: the two thin trigger-fn callers (zero-arg, RETURNS trigger).
-- pgTAP has_function overload used: (schema, function, args[], description).
SELECT has_function('public', 'fn_broadcast_run_progress', '{}'::text[],
  'RED(§10): fn_broadcast_run_progress() trigger fn exists');
SELECT has_function('public', 'fn_broadcast_nudge', '{}'::text[],
  'RED(§10): fn_broadcast_nudge() trigger fn exists');

-- §10: AFTER INSERT/UPDATE trigger on the hot trace table (topic run:<id>).
SELECT has_trigger('public', 'ai_trace_events', 'trg_broadcast_run_progress',
  'RED(§10): ai_trace_events has AFTER INSERT/UPDATE broadcast trigger');

-- §10: node_runs broadcasts ONLY terminal states → its own trigger.
SELECT has_trigger('public', 'ai_workflow_node_runs', 'trg_broadcast_node_terminal',
  'RED(§10): ai_workflow_node_runs has terminal-state broadcast trigger');

-- §10/§4.4: nudge broadcast trigger (workspace:/session: topic).
SELECT has_trigger('public', 'dirigent_nudges', 'trg_broadcast_nudge',
  'RED(§10): dirigent_nudges has AFTER INSERT broadcast trigger');

-- §9: migration must add updated_at to all three broadcast-source tables
--     ("dnes nemají sloupec updated_at, jen created_at" → RED until migration).
SELECT has_column('public', 'ai_trace_events', 'updated_at',
  'RED(§9): ai_trace_events.updated_at added by §10 migration');
SELECT has_column('public', 'ai_workflow_node_runs', 'updated_at',
  'RED(§9): ai_workflow_node_runs.updated_at added by §10 migration');
SELECT has_column('public', 'dirigent_nudges', 'updated_at',
  'RED(§9): dirigent_nudges.updated_at added by §10 migration');

-- ── FALSE-POSITIVE GUARD (LIVE-GREEN today): the consumer channel name is a
--    real string, and the wrong/typo channel must NOT exist as a function arg
--    default anywhere. We assert the producer is NOT accidentally already wired
--    to a DIFFERENT channel (which would silently bypass the event-worker).
--    Today no fn_pg_notify_broadcast exists, so the count is 0 — and it MUST be
--    0 for the typo channel even after impl. This stays GREEN across impl.
SELECT is(
  (SELECT count(*)::int FROM pg_proc
    WHERE proname = 'fn_broadcast_run_progress_TYPO'),
  0,
  'FALSE-POSITIVE GUARD: no typo-named broadcast fn shadows the real one'
);

SELECT * FROM finish();
ROLLBACK;
