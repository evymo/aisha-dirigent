-- Index: idx_moderation_sessions_active

CREATE INDEX idx_moderation_sessions_active ON public.moderation_sessions USING btree (status) WHERE (status = 'active'::text);
