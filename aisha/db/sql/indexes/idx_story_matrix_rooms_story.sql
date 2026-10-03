-- Index: idx_story_matrix_rooms_story

CREATE INDEX IF NOT EXISTS idx_story_matrix_rooms_story ON public.story_matrix_rooms USING btree (story_id);
