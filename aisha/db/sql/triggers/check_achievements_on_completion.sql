-- Trigger: check_achievements_on_completion
-- Table: reminder_completions

CREATE TRIGGER check_achievements_on_completion
AFTER INSERT
ON public.reminder_completions
FOR EACH ROW
EXECUTE FUNCTION trigger_check_achievements();
