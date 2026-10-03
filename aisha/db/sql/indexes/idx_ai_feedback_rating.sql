-- Index: idx_ai_feedback_rating
CREATE INDEX IF NOT EXISTS idx_ai_feedback_rating ON public.ai_feedback(rating) WHERE rating >= 4;
