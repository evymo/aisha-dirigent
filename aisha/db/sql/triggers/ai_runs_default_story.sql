-- Trigger: ai_runs_default_story
-- Source of truth pair: aisha/db/sql/functions/fn_ai_runs_default_story.sql
-- Lives in triggers/ (emitted AFTER functions) so the function exists when it binds.
--
-- BEFORE INSERT, so the anchor is set before the NOT NULL check on story_id —
-- that ordering is what lets the constraint be real instead of aspirational.

DROP TRIGGER IF EXISTS ai_runs_default_story ON public.ai_runs;
CREATE TRIGGER ai_runs_default_story
  BEFORE INSERT ON public.ai_runs
  FOR EACH ROW EXECUTE FUNCTION public.fn_ai_runs_default_story();
