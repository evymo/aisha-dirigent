-- Index: idx_session_memory_user

CREATE INDEX idx_session_memory_user ON public.ai_session_memory USING btree (user_id);
