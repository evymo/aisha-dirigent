-- Index: idx_moderation_sessions_story

CREATE INDEX idx_moderation_sessions_story ON public.moderation_sessions USING btree (story_id) WHERE (story_id IS NOT NULL);
