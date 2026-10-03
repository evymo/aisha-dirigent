-- Index: idx_story_rulesets_fp

CREATE INDEX idx_story_rulesets_fp ON public.story_rulesets USING btree (ruleset_fingerprint);
