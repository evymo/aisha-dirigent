-- Index: idx_moderation_sessions_user

CREATE INDEX idx_moderation_sessions_user ON public.moderation_sessions USING btree (user_id, status);
