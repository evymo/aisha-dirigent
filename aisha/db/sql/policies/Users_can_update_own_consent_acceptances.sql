-- Policy: Users can update own consent acceptances

CREATE POLICY "Users can update own consent acceptances" ON public.study_consent_acceptances
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
