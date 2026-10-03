-- Index: idx_sla_tracking_story

CREATE INDEX IF NOT EXISTS idx_sla_tracking_story ON public.sla_tracking USING btree (story_id);
