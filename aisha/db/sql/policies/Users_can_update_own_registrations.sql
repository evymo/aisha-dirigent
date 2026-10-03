-- Policy: Users can update own registrations

CREATE POLICY "Users can update own registrations" ON public.study_registrations
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
