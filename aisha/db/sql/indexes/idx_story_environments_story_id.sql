-- Index: idx_story_environments_story_id

CREATE INDEX idx_story_environments_story_id ON public.story_environments USING btree (story_id);
