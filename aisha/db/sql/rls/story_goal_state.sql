-- RLS: story_goal_state
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
--
-- Read: authenticated participants of the story may inspect goal state.
-- Write: service_role only (mutated by goal_evaluator playbook + edge fn).

ALTER TABLE public.story_goal_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full_access_goal_state ON public.story_goal_state;
CREATE POLICY service_role_full_access_goal_state ON public.story_goal_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS auth_read_own_story_goal_state ON public.story_goal_state;
CREATE POLICY auth_read_own_story_goal_state ON public.story_goal_state
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM story_participants sp
      WHERE sp.story_id = story_goal_state.story_id
        AND sp.user_id = auth.uid()
    )
  );
