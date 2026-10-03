-- Trigger: update_ai_batch_jobs_updated_at
-- Maintains updated_at on ai_batch_jobs row mutations (Phase 2D LLM Gateway).

CREATE TRIGGER update_ai_batch_jobs_updated_at
  BEFORE UPDATE ON public.ai_batch_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
