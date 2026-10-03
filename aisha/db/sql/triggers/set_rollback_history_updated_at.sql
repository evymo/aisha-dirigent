-- Trigger: set_rollback_history_updated_at

CREATE TRIGGER set_rollback_history_updated_at
  BEFORE UPDATE ON public.rollback_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
