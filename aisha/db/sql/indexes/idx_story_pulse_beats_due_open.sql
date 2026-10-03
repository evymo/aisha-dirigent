-- Index: idx_story_pulse_beats_due_open
-- "What is due" — the scan any due-queue or sweeper performs.

CREATE INDEX IF NOT EXISTS idx_story_pulse_beats_due_open ON public.story_pulse_beats USING btree (due_at) WHERE (status = 'open'::text);
