-- Index: idx_story_ai_sessions_conversation_id
-- Table: story_ai_sessions

CREATE INDEX IF NOT EXISTS idx_story_ai_sessions_conversation_id ON public.story_ai_sessions(conversation_id);
