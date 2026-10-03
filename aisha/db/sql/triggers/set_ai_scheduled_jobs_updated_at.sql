-- Trigger: set_ai_scheduled_jobs_updated_at

CREATE TRIGGER set_ai_scheduled_jobs_updated_at
  BEFORE UPDATE ON public.ai_scheduled_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
