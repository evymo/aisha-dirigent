-- Policy: Users can insert own consent acceptances

CREATE POLICY "Users can insert own consent acceptances" ON public.study_consent_acceptances
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
