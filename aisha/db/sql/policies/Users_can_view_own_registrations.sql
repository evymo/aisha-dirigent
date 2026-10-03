-- Policy: Users can view own registrations

CREATE POLICY "Users can view own registrations" ON public.study_registrations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
