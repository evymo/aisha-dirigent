-- Policy: story_pulse_beats_admin_staff_manage
-- Operators (admin/staff) manage every beat: the queue of what each twin owes
-- is an operational surface. Members reach their own beats through the
-- read-only policy next to this one; nobody writes beats directly — the
-- SECURITY DEFINER RPCs (create_pulse_beat_audited / close_pulse_beat_audited)
-- are the only write path, so no INSERT/UPDATE grant is issued to authenticated.
DROP POLICY IF EXISTS "story_pulse_beats_admin_staff_manage" ON public.story_pulse_beats;
CREATE POLICY "story_pulse_beats_admin_staff_manage" ON public.story_pulse_beats
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
