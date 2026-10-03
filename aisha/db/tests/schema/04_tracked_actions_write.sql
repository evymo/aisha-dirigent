-- pgTAP functional test — tracked_action WRITE path + reminder CRUD + adherence (PR #438)
-- ============================================================================
-- Proves the generic tracked_action surface actually persists and round-trips:
--   create_user_reminder  -> a user_reminders row (is_active=true)
--   record_tracked_action -> a tracked_actions row linked to that reminder
--   get_my_tracked_actions-> the recorded action surfaces through the 5th arm
--                            with source='tracked_action' + caller action_type
--   ownership guard        -> record_tracked_action against ANOTHER user's
--                            reminder is denied (fn's own EXISTS check, not RLS)
--   update_/deactivate_user_reminder -> mutate then soft-retire (is_active=false)
--   get_my_action_adherence-> expected/actual/adherence_ratio computed EXACTLY
--                            as the function's CTEs do (daily: expected=window_days)
--
-- Runs against the APPLIED (unseeded) cold-start schema as SUPERUSER, so RLS is
-- not enforced for us; ownership is proven via each function's own auth.uid()
-- guards. Identity is faked through request.jwt.claims (auth.uid() reads ->>'sub').
-- Fixtures are seeded with session_replication_role=replica to bypass FK/triggers.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

-- ── Parametric identities ────────────────────────────────────────────────────
SELECT set_config('ta.userA',   gen_random_uuid()::text, true);
SELECT set_config('ta.userB',   gen_random_uuid()::text, true);
SELECT set_config('ta.remB',    gen_random_uuid()::text, true);  -- reminder owned by B
SELECT set_config('ta.remD',    gen_random_uuid()::text, true);  -- A's daily reminder (adherence)

-- ── Seed auth users (FK/triggers off; template seeds aisha_auth.users with id only)
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES
  (current_setting('ta.userA')::uuid),
  (current_setting('ta.userB')::uuid);
-- A reminder owned by user B (for the ownership-guard arm). Minimal NOT NULL cols:
-- user_id, title, reminder_type, frequency, time_of_day (rest have defaults).
INSERT INTO user_reminders (id, user_id, title, reminder_type, frequency, time_of_day)
  VALUES (current_setting('ta.remB')::uuid, current_setting('ta.userB')::uuid,
          'B reminder', 'medication', 'daily', '08:00');
SET session_replication_role = origin;

-- ── Authenticate as user A ───────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('ta.userA'), 'role','authenticated')::text, true);

-- (1) signature sanity: record_tracked_action is the 4-arg member-aware writer.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='record_tracked_action' AND p.pronargs=4),
  '(1) record_tracked_action(text,jsonb,uuid,timestamptz) exists');

-- (2) create_user_reminder with the REQUIRED args -> returns a uuid; the row
--     exists for A and is active by default.
SELECT set_config('ta.rem', (
  create_user_reminder(
    p_title       := 'Take morning meds',
    p_reminder_type := 'medication',
    p_frequency   := 'weekly',
    p_time_of_day := '09:00'::time
  ))::text, true);
SELECT ok(
  EXISTS (SELECT 1 FROM user_reminders
          WHERE id = current_setting('ta.rem')::uuid
            AND user_id = current_setting('ta.userA')::uuid
            AND is_active IS TRUE
            AND title = 'Take morning meds'
            AND reminder_type = 'medication'
            AND frequency = 'weekly'),
  '(2) create_user_reminder persists an active reminder owned by A');

-- (3) record_tracked_action(action_type, payload, reminder_id) -> uuid; a
--     tracked_actions row exists for A linked to that reminder.
SELECT set_config('ta.action', (
  record_tracked_action(
    p_action_type := 'symptom_logged',
    p_payload     := '{"severity":3}'::jsonb,
    p_reminder_id := current_setting('ta.rem')::uuid
  ))::text, true);
SELECT ok(
  EXISTS (SELECT 1 FROM tracked_actions
          WHERE id = current_setting('ta.action')::uuid
            AND user_id = current_setting('ta.userA')::uuid
            AND action_type = 'symptom_logged'
            AND reminder_id = current_setting('ta.rem')::uuid
            AND payload = '{"severity":3}'::jsonb),
  '(3) record_tracked_action persists a tracked_actions row linked to A''s reminder');

-- (4) get_my_tracked_actions surfaces the recorded action through the 5th arm
--     with source='tracked_action' and the caller-supplied action_type.
SELECT ok(
  EXISTS (
    SELECT 1 FROM get_my_tracked_actions() g
    WHERE g.id = current_setting('ta.action')::uuid
      AND g.source = 'tracked_action'
      AND g.action_type = 'symptom_logged'
      AND g.reminder_id = current_setting('ta.rem')::uuid
  ),
  '(4) get_my_tracked_actions 5th arm: source=tracked_action, caller action_type');

-- (4b) the action_type filter narrows to the recorded action.
SELECT is(
  (SELECT count(*)::int FROM get_my_tracked_actions(NULL, 'symptom_logged', 100) g
   WHERE g.source = 'tracked_action'),
  1, '(4b) action_type filter returns exactly the one recorded tracked_action');

-- (5) ownership guard: as A, recording against B's reminder is denied by the
--     function's own EXISTS(user_id = caller) check.
SELECT throws_ok(
  $ta$ SELECT record_tracked_action('symptom_logged', '{}'::jsonb,
         current_setting('ta.remB')::uuid) $ta$,
  NULL, NULL,
  '(5) record_tracked_action against another user''s reminder is denied');

-- (6a) update_user_reminder changes a field (title) for A.
SELECT lives_ok(
  $ta$ SELECT update_user_reminder(current_setting('ta.rem')::uuid,
         p_title := 'Take evening meds') $ta$,
  '(6a) update_user_reminder mutates an owned reminder');
SELECT is(
  (SELECT title FROM user_reminders WHERE id = current_setting('ta.rem')::uuid),
  'Take evening meds', '(6b) update_user_reminder persisted the new title');

-- (6c) deactivate_user_reminder flips is_active to false.
SELECT lives_ok(
  $ta$ SELECT deactivate_user_reminder(current_setting('ta.rem')::uuid) $ta$,
  '(6c) deactivate_user_reminder runs for an owned reminder');
SELECT is(
  (SELECT is_active FROM user_reminders WHERE id = current_setting('ta.rem')::uuid),
  false, '(6d) deactivate_user_reminder set is_active = false');

-- (7) adherence: a DAILY active reminder over a 7-day window. The function's
--     exp_cte daily branch makes expected = v_days = 7. We insert exactly 5
--     completions at now() (>= v_start = now()-7d), so act_cte act_count = 5, and
--     adherence_ratio = LEAST(5/7, 1.0) = 5/7. Only ACTIVE reminders appear, so
--     the now-deactivated 'ta.rem' is excluded — this daily one is the lone row.
SET session_replication_role = replica;
INSERT INTO user_reminders (id, user_id, title, reminder_type, frequency, time_of_day, is_active)
  VALUES (current_setting('ta.remD')::uuid, current_setting('ta.userA')::uuid,
          'Daily vitamin', 'supplement', 'daily', '07:00', true);
INSERT INTO reminder_completions (user_id, reminder_id, completed_at, scheduled_for)
  SELECT current_setting('ta.userA')::uuid, current_setting('ta.remD')::uuid, now(), now()
  FROM generate_series(1, 5);
SET session_replication_role = origin;

-- expected = 7, actual = 5, adherence_ratio = 5/7, action_type = reminder_type.
SELECT is(
  (SELECT (expected, actual, round(adherence_ratio, 6), action_type)::text
   FROM get_my_action_adherence(7)
   WHERE reminder_id = current_setting('ta.remD')::uuid),
  (7, 5, round((5::numeric / 7), 6), 'supplement')::text,
  '(7) get_my_action_adherence: daily expected=7, actual=5, ratio=5/7, action_type=reminder_type');

SELECT * FROM finish();
ROLLBACK;