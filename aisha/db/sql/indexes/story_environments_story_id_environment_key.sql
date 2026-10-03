-- Index: story_environments_story_id_environment_key

CREATE UNIQUE INDEX story_environments_story_id_environment_key ON public.story_environments USING btree (story_id, environment);
