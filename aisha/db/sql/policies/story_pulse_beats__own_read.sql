-- Policy: story_pulse_beats_own_read
-- A person sees the beats they OWE (assignee) and the beats their own twin
-- carries (subject_type='actor' AND subject_id = their uid). Read-only and
-- PERMISSIVE-OR'd with the operator policy.
--
-- Scoped by subject_type ON PURPOSE: 'actor' is the only kind whose subject_id
-- is a user id. A blanket `subject_id = auth.uid()` would, on any future kind
-- keyed by some other uuid space, hand rows to whoever happened to share the
-- id — the polymorphic axis has no FK to stop that.
CREATE POLICY "story_pulse_beats_own_read" ON public.story_pulse_beats
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    assigned_to_user_id = auth.uid()
    OR (subject_type = 'actor' AND subject_id = auth.uid())
  );
