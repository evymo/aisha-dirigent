-- Policy: story_pulse_beats_service_role_all
-- service_role does NOT bypass RLS in this stack — every table it must reach
-- carries an explicit policy (see Service_role_full_access_to_tasks.sql and the
-- acs_* family). Without this, a service-side sweeper or dispatcher would read
-- zero rows while its GRANT suggested otherwise.
CREATE POLICY "story_pulse_beats_service_role_all" ON public.story_pulse_beats
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));
