-- Index: idx_story_entries_created_at
-- Table: story_entries

CREATE INDEX idx_story_entries_created_at ON public.story_entries USING btree (story_id, created_at DESC);
