-- Index: idx_story_participants_user

CREATE INDEX idx_story_participants_user ON public.story_participants USING btree (user_id);
