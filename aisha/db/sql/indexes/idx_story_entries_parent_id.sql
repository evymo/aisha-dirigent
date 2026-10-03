-- Index: idx_story_entries_parent_id
-- Table: story_entries

CREATE INDEX idx_story_entries_parent_id ON public.story_entries USING btree (parent_id);
