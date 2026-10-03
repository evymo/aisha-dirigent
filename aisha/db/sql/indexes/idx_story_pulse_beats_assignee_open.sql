-- Index: idx_story_pulse_beats_assignee_open
-- "What do I owe" — the per-addressee work queue.

CREATE INDEX IF NOT EXISTS idx_story_pulse_beats_assignee_open ON public.story_pulse_beats USING btree (assigned_to_user_id, due_at) WHERE (status = 'open'::text);
