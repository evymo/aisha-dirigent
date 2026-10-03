-- Index: idx_story_entries_type
-- Table: story_entries

CREATE INDEX idx_story_entries_type ON public.story_entries USING btree (story_id, entry_type);
