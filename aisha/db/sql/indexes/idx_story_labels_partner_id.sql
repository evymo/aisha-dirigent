-- Index: idx_story_labels_partner_id
-- Table: story_labels

CREATE INDEX idx_story_labels_partner_id ON public.story_labels USING btree (partner_id);
