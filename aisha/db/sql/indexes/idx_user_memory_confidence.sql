-- Index: idx_user_memory_confidence

CREATE INDEX idx_user_memory_confidence ON public.ai_user_memory USING btree (user_id, confidence DESC);
