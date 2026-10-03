-- Index: idx_story_reminders_story_id
-- Table: story_reminders

CREATE INDEX idx_story_reminders_story_id ON public.story_reminders USING btree (story_id);
