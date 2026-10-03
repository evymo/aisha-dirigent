-- Index: idx_story_pulse_beats_source_open
-- "Is this regime's beat already open" — the provenance lookup every domain
-- confirmation path uses to find the beat it closes. Unindexed this would be a
-- seq scan on the hot path (the defect idx_ai_tasks_status carries today).

CREATE INDEX IF NOT EXISTS idx_story_pulse_beats_source_open ON public.story_pulse_beats USING btree (source_type, source_id) WHERE (status = 'open'::text);
