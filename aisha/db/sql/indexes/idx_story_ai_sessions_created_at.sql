-- Index: idx_story_ai_sessions_created_at
-- Table: story_ai_sessions

CREATE INDEX idx_story_ai_sessions_created_at ON public.story_ai_sessions USING btree (story_id, created_at DESC);
