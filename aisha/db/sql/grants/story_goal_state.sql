-- Grants: story_goal_state
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql

GRANT SELECT ON public.story_goal_state TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.story_goal_state TO service_role;
