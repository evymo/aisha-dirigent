-- Index: idx_call_participants_user

CREATE INDEX IF NOT EXISTS idx_call_participants_user ON public.call_participants USING btree (user_id);
