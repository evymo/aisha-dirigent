-- Trigger: set_updated_at_ai_eval_runs

CREATE TRIGGER set_updated_at_ai_eval_runs
  BEFORE UPDATE ON public.ai_eval_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
