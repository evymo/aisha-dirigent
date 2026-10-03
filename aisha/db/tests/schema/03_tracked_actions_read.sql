-- pgTAP schema-contract tests — get_my_tracked_actions (universal read-model, PR #437)
-- ============================================================================
-- get_my_tracked_actions() is a SECURITY DEFINER read-model that UNIONs several
-- thematic source tables (reminder_completions, dosing_logs, health_check_ins,
-- questionnaire_responses, tracked_actions) into one generic shape
-- (id, action_type, occurred_at, reminder_id, source, source_id, payload).
--
-- We fixture the SIMPLEST source arm — dosing_logs (only required columns are the
-- defaulted id + user_id) — which the function maps to:
--   action_type := 'dose', source := 'dosing_log',
--   occurred_at := COALESCE(logged_at, dosed_at, created_at).
--
-- Asserts: (1) own row surfaces with the mapped action_type/source/occurred_at,
-- (2) own-only scoping (another user's row is invisible to caller A — the WHERE
-- user_id = auth.uid() guard, which is what RLS would enforce; we prove it via the
-- function's own predicate since superuser bypasses RLS), (3) the p_action_type
-- and p_since narrowing filters, and (4) the auth.uid() IS NULL guard (RAISE
-- EXCEPTION 'Unauthorized'). Runs against the APPLIED (unseeded) cold-start schema
-- as superuser; fixtures use session_replication_role=replica to bypass FK/triggers;
-- JWT identity is simulated via request.jwt.claims (auth.uid() = sub claim).
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

-- ── Parametric identities (stable across the file via current_setting) ───────
SELECT set_config('gta.user_a',  gen_random_uuid()::text, true);
SELECT set_config('gta.user_b',  gen_random_uuid()::text, true);
SELECT set_config('gta.log_a',   gen_random_uuid()::text, true);
SELECT set_config('gta.log_b',   gen_random_uuid()::text, true);
-- Known occurred_at for A's dose; B is seeded at a different (later) time.
SELECT set_config('gta.at_a',    '2026-01-15T10:00:00+00:00', true);
SELECT set_config('gta.at_b',    '2026-02-20T10:00:00+00:00', true);

-- ── Fixtures (FK/triggers off so the cold-start unseeded schema accepts them) ─
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES
  (current_setting('gta.user_a')::uuid),
  (current_setting('gta.user_b')::uuid);
-- One dose log per user. logged_at is set explicitly so occurred_at is deterministic
-- (occurred_at := COALESCE(logged_at, dosed_at, created_at)).
INSERT INTO dosing_logs (id, user_id, logged_at, dose_amount, dose_unit) VALUES
  (current_setting('gta.log_a')::uuid, current_setting('gta.user_a')::uuid,
     current_setting('gta.at_a')::timestamptz, '2', 'mg'),
  (current_setting('gta.log_b')::uuid, current_setting('gta.user_b')::uuid,
     current_setting('gta.at_b')::timestamptz, '5', 'mg');
SET session_replication_role = origin;

-- ── (1) Authenticate as A; the dose log surfaces with the mapped contract ────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('gta.user_a'), 'role', 'authenticated')::text, true);

SELECT is(
  (SELECT count(*)::int FROM get_my_tracked_actions()
     WHERE source_id = current_setting('gta.log_a')::uuid),
  1, '(1a) A''s own dosing_log row is returned by get_my_tracked_actions()');

SELECT is(
  (SELECT action_type || '|' || source || '|' || occurred_at::text
     FROM get_my_tracked_actions()
     WHERE source_id = current_setting('gta.log_a')::uuid),
  'dose|dosing_log|' || (current_setting('gta.at_a')::timestamptz)::text,
  '(1b) dosing_logs arm maps to action_type=dose, source=dosing_log, occurred_at=logged_at');

-- ── (2) Own-only scoping: B''s row is invisible to caller A ──────────────────
SELECT is(
  (SELECT count(*)::int FROM get_my_tracked_actions()
     WHERE source_id = current_setting('gta.log_b')::uuid),
  0, '(2) own-only scoping: B''s dosing_log row is NOT in A''s result set');

-- ── (3) p_action_type filter narrows correctly ───────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM get_my_tracked_actions(NULL, 'dose')
     WHERE source_id = current_setting('gta.log_a')::uuid),
  1, '(3a) p_action_type=''dose'' keeps the matching dose row');

SELECT is(
  (SELECT count(*)::int FROM get_my_tracked_actions(NULL, '__no_such_action_type__')),
  0, '(3b) p_action_type with no match narrows the result to zero rows');

-- ── (4) p_since filter narrows correctly (A''s dose at at_a) ──────────────────
SELECT is(
  ARRAY[
    (SELECT count(*)::int FROM get_my_tracked_actions(current_setting('gta.at_a')::timestamptz - interval '1 day')
       WHERE source_id = current_setting('gta.log_a')::uuid),
    (SELECT count(*)::int FROM get_my_tracked_actions(current_setting('gta.at_a')::timestamptz + interval '1 day')
       WHERE source_id = current_setting('gta.log_a')::uuid)
  ],
  ARRAY[1, 0],
  '(4) p_since: before-occurred_at includes the row, after-occurred_at excludes it');

-- ── (5) Unauthenticated caller (no sub claim) → function guards auth.uid() ────
-- get_my_tracked_actions RAISEs EXCEPTION 'Unauthorized' when auth.uid() IS NULL
-- (default raise_exception SQLSTATE P0001).
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated')::text, true);
SELECT throws_ok(
  $gta$ SELECT * FROM get_my_tracked_actions() $gta$,
  'P0001', NULL, '(5) unauthenticated caller (no sub) is denied with Unauthorized (P0001)');

SELECT * FROM finish();
ROLLBACK;