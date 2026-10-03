-- Index: uq_story_pulse_beats_open_slot
-- Idempotence of beat generation: one OPEN beat per (subject, kind, deadline,
-- originating regime). source_* belongs in the key — without it two distinct
-- regimes falling due at the same moment on the same twin would collapse into
-- one beat, and the confirmation path that matches on (source_type, source_id)
-- would then close the wrong one.

CREATE UNIQUE INDEX IF NOT EXISTS uq_story_pulse_beats_open_slot ON public.story_pulse_beats USING btree (subject_type, subject_id, beat_type, due_at, COALESCE(source_type, ''::text), COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = 'open'::text);
