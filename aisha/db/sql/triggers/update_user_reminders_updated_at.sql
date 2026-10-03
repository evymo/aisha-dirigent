-- Trigger: update_user_reminders_updated_at
-- Table: user_reminders

CREATE TRIGGER update_user_reminders_updated_at
BEFORE UPDATE
ON public.user_reminders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
