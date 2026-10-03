-- Index: idx_story_matrix_rooms_matrix

CREATE INDEX IF NOT EXISTS idx_story_matrix_rooms_matrix ON public.story_matrix_rooms USING btree (matrix_room_id);
