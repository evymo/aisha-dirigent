-- Index: idx_call_events_room

CREATE INDEX IF NOT EXISTS idx_call_events_room ON public.call_events USING btree (voice_room_id, created_at);
