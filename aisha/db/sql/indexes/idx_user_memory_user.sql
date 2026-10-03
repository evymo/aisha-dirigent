-- Index: idx_user_memory_user

CREATE INDEX idx_user_memory_user ON public.ai_user_memory USING btree (user_id);
