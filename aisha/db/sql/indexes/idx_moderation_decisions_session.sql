-- Index: idx_moderation_decisions_session

CREATE INDEX idx_moderation_decisions_session ON public.moderation_decisions USING btree (session_id, created_at);
