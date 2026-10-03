-- Trigger: update_streak_on_reminder_completion
-- Table: reminder_completions

CREATE TRIGGER update_streak_on_reminder_completion
AFTER INSERT
ON public.reminder_completions
FOR EACH ROW
EXECUTE FUNCTION trigger_update_streak_on_reminder_completion();
