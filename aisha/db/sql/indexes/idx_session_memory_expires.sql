-- Index: idx_session_memory_expires

CREATE INDEX idx_session_memory_expires ON public.ai_session_memory USING btree (expires_at) WHERE (expires_at IS NOT NULL);
