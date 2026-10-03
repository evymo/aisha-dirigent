-- Index: idx_agent_live_sessions_story
-- Partial index for story-scoped live-session lookups.

CREATE INDEX IF NOT EXISTS idx_agent_live_sessions_story
  ON public.agent_live_sessions (story_id)
  WHERE story_id IS NOT NULL;
