-- Index: idx_personality_signals_created

CREATE INDEX IF NOT EXISTS idx_personality_signals_created ON public.personality_signals USING btree (created_at);
