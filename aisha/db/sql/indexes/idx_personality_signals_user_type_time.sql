-- Index: idx_personality_signals_user_type_time

CREATE INDEX IF NOT EXISTS idx_personality_signals_user_type_time ON public.personality_signals USING btree (user_id, signal_type, created_at DESC);
