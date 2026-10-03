-- Policy: Users can create own registrations

CREATE POLICY "Users can create own registrations" ON public.study_registrations
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
