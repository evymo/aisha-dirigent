-- Index: idx_story_rulesets_story

CREATE INDEX idx_story_rulesets_story ON public.story_rulesets USING btree (story_id);
