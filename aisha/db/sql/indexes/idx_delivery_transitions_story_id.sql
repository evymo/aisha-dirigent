-- Index: idx_delivery_transitions_story_id

CREATE INDEX idx_delivery_transitions_story_id ON public.delivery_transitions USING btree (story_id);
