-- Index: idx_ai_feedback_story_id
CREATE INDEX IF NOT EXISTS idx_ai_feedback_story_id ON public.ai_feedback(story_id) WHERE story_id IS NOT NULL;
