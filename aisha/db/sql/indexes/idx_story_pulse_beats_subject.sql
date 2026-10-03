-- Index: idx_story_pulse_beats_subject
-- "What does this twin owe" — the subject axis, open and settled alike, because
-- the timeline reads history too.

CREATE INDEX IF NOT EXISTS idx_story_pulse_beats_subject ON public.story_pulse_beats USING btree (subject_type, subject_id, due_at);
