-- Index: ai_decisions lookup by story (journal queries + RLS chain).
CREATE INDEX IF NOT EXISTS idx_ai_decisions_story
  ON public.ai_decisions (story_id, created_at DESC);
