-- Index: idx_call_participants_room

CREATE INDEX IF NOT EXISTS idx_call_participants_room ON public.call_participants USING btree (voice_room_id);
