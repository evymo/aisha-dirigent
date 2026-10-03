-- Table: tracked_actions
-- The generic home for ad-hoc "the user did / reacted to something" events that
-- have no richer thematic table (a dose -> dosing_logs, a check-in ->
-- health_check_ins, a reminder completion -> reminder_completions, a
-- questionnaire -> questionnaire_responses). Written by record_tracked_action and
-- surfaced, alongside those thematic sources, by get_my_tracked_actions. This is
-- the write side of the universal tracked_action abstraction; it does NOT replace
-- the thematic tables, it only catches actions that would otherwise have nowhere
-- to land.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.tracked_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reminder_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT tracked_actions_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES user_reminders(id) ON DELETE SET NULL,
  CONSTRAINT tracked_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.tracked_actions ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned data table. Writes go ONLY through record_tracked_action
-- (SECURITY DEFINER) — there is deliberately no direct-INSERT policy, so
-- authenticated is NOT granted INSERT (an INSERT grant without a matching RLS
-- policy is dead + misleading). Direct SELECT is RLS-scoped to the owner by
-- policies/Users_can_view_their_own_tracked_actions.sql; the index lives in
-- indexes/tracked_actions_user_occurred_idx.sql (SoT separation).
GRANT SELECT ON public.tracked_actions TO authenticated;
GRANT ALL ON public.tracked_actions TO service_role;
