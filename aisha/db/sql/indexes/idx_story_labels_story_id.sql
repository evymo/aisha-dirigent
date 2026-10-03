-- Index: idx_story_labels_story_id
-- Table: story_labels

CREATE INDEX idx_story_labels_story_id ON public.story_labels USING btree (story_id);
