-- Index: idx_voice_rooms_livekit

CREATE INDEX IF NOT EXISTS idx_voice_rooms_livekit ON public.voice_rooms USING btree (livekit_room_name);
