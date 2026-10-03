-- Index: idx_ai_feedback_unprocessed
CREATE INDEX IF NOT EXISTS idx_ai_feedback_unprocessed ON public.ai_feedback(created_at)
  WHERE is_processed = false;
