-- Index: idx_ai_feedback_run_id
CREATE INDEX IF NOT EXISTS idx_ai_feedback_run_id ON public.ai_feedback(run_id) WHERE run_id IS NOT NULL;
