-- pgTAP — data-driven proactive dispatch engine
-- ============================================================================
-- The stack must run EVENT-DRIVEN, nothing periodic. ai_proactive_trigger_definitions
-- was designed as a data-driven reactive rule store but had no auto-fire dispatcher.
-- This engine wires it: an active rule row auto-installs a generic AFTER INSERT/UPDATE
-- trigger on its source_table; a matching write records a pending ai_proactive_runs row
-- and fires pg_notify('ai_proactive_dispatch') (+ optional n8n bridge). No table is polled.
-- Verifies: engine objects present · condition DSL · auto-install/remove · dispatch ·
-- condition gate · cooldown. Runs after baseline+heals; fully rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);

SELECT set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);

-- ── Engine objects present ────────────────────────────────────────────────
SELECT has_function('public', 'fn_dispatch_proactive_triggers', '(1) generic dispatch trigger fn exists');
SELECT has_function('public', 'fn_proactive_condition_matches',
  ARRAY['jsonb','jsonb','jsonb','text'], '(2) condition evaluator exists');
SELECT has_trigger('public', 'ai_proactive_trigger_definitions', 'trg_proactive_defs_sync',
  '(3) meta-trigger keeps installs in sync with the rules');

-- ── Condition DSL (pure, injection-free) ──────────────────────────────────
SELECT ok(fn_proactive_condition_matches('{}'::jsonb, '{"a":1}'::jsonb, NULL, 'INSERT'),
  '(4) empty condition always matches');
SELECT ok(fn_proactive_condition_matches('{"status":"queued"}'::jsonb, '{"status":"queued","x":1}'::jsonb, NULL, 'INSERT'),
  '(5) equality condition matches when NEW contains it');
SELECT ok(NOT fn_proactive_condition_matches('{"status":"queued"}'::jsonb, '{"status":"running"}'::jsonb, NULL, 'INSERT'),
  '(6) equality condition fails on mismatch');
SELECT ok(fn_proactive_condition_matches('{"__changed":["status"]}'::jsonb, '{"status":"b"}'::jsonb, '{"status":"a"}'::jsonb, 'UPDATE'),
  '(7) __changed matches when the field actually changed');
SELECT ok(NOT fn_proactive_condition_matches('{"__changed":["status"]}'::jsonb, '{"status":"a"}'::jsonb, '{"status":"a"}'::jsonb, 'UPDATE'),
  '(8) __changed fails when the field did not change');

-- ── Auto-install + dispatch (end-to-end) ──────────────────────────────────
-- A throwaway source table in public (rolled back with the txn).
CREATE TABLE public._proactive_test_src (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  status text
);

SELECT hasnt_trigger('public', '_proactive_test_src', 'trg_proactive_dispatch',
  '(9) no dispatch trigger before any rule references the table');

SELECT set_config('pd.actor', gen_random_uuid()::text, true);

-- Add an active INSERT rule → meta-trigger installs the dispatch trigger.
INSERT INTO ai_proactive_trigger_definitions
  (name, source_table, source_event, condition, action_type, workflow_name, is_active, cooldown_minutes, created_by)
VALUES
  ('_test_insert_rule', '_proactive_test_src', 'INSERT', '{"status":"pending"}'::jsonb,
   'analyze', 'test-workflow', true, 60, gen_random_uuid());

SELECT has_trigger('public', '_proactive_test_src', 'trg_proactive_dispatch',
  '(10) activating a rule auto-installs the dispatch trigger on its source_table');

-- Matching insert → exactly one pending proactive run.
-- The dispatch trigger journals to audit_journal, whose user_id is a real FK to
-- aisha_auth.users — so the actor has to EXIST. A random uuid made this fixture
-- describe a state the system cannot hold.
INSERT INTO aisha_auth.users (id) VALUES (current_setting('pd.actor')::uuid) ON CONFLICT (id) DO NOTHING;
INSERT INTO public._proactive_test_src (user_id, status)
  VALUES (current_setting('pd.actor')::uuid, 'pending');
SELECT is(
  (SELECT count(*)::int FROM ai_proactive_runs
   WHERE trigger_definition_id = (SELECT id FROM ai_proactive_trigger_definitions WHERE name='_test_insert_rule')),
  1, '(11) a matching insert dispatches exactly one pending run (event-driven, no poll)');
SELECT is(
  (SELECT status FROM ai_proactive_runs
   WHERE trigger_definition_id = (SELECT id FROM ai_proactive_trigger_definitions WHERE name='_test_insert_rule') LIMIT 1),
  'pending', '(12) the dispatched run is pending, awaiting the executor');

-- Non-matching insert → the condition gate suppresses it (still exactly one run).
INSERT INTO public._proactive_test_src (user_id, status) VALUES (gen_random_uuid(), 'done');
SELECT is(
  (SELECT count(*)::int FROM ai_proactive_runs
   WHERE trigger_definition_id = (SELECT id FROM ai_proactive_trigger_definitions WHERE name='_test_insert_rule')),
  1, '(13) a non-matching insert does not dispatch (condition gate holds)');

-- ── Cooldown (per definition + source record) ─────────────────────────────
-- An UPDATE rule with cooldown; the same row updated twice fires once.
INSERT INTO ai_proactive_trigger_definitions
  (name, source_table, source_event, condition, action_type, is_active, cooldown_minutes, created_by)
VALUES
  ('_test_update_rule', '_proactive_test_src', 'UPDATE', '{"__changed":["status"]}'::jsonb,
   'analyze', true, 60, gen_random_uuid());

SELECT set_config('t.rowid', gen_random_uuid()::text, true);
INSERT INTO public._proactive_test_src (id, user_id, status)
  VALUES (current_setting('t.rowid')::uuid, current_setting('pd.actor')::uuid, 'open');
UPDATE public._proactive_test_src SET status = 'closed' WHERE id = current_setting('t.rowid')::uuid;
UPDATE public._proactive_test_src SET status = 'reopened' WHERE id = current_setting('t.rowid')::uuid;
SELECT is(
  (SELECT count(*)::int FROM ai_proactive_runs
   WHERE trigger_definition_id = (SELECT id FROM ai_proactive_trigger_definitions WHERE name='_test_update_rule')
     AND source_record_id = current_setting('t.rowid')::uuid),
  1, '(14) two updates to the same row within cooldown dispatch only once');

-- ── Deactivate → trigger removed when no active rule remains ───────────────
UPDATE ai_proactive_trigger_definitions SET is_active = false
  WHERE source_table = '_proactive_test_src';
SELECT hasnt_trigger('public', '_proactive_test_src', 'trg_proactive_dispatch',
  '(15) deactivating the last rule removes the dispatch trigger (zero overhead)');

-- ── Reconcile utility is idempotent and reports install count ──────────────
SELECT lives_ok('SELECT fn_reconcile_proactive_dispatch_installs()',
  '(16) full reconcile runs cleanly (cold-start / healing safe)');

SELECT * FROM finish();
ROLLBACK;
