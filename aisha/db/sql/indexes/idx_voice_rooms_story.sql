-- Index: idx_voice_rooms_story

CREATE INDEX IF NOT EXISTS idx_voice_rooms_story ON public.voice_rooms USING btree (story_id) WHERE (story_id IS NOT NULL);
