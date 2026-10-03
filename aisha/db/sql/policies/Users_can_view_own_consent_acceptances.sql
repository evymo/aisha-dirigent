-- Policy: Users can view own consent acceptances

CREATE POLICY "Users can view own consent acceptances" ON public.study_consent_acceptances
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
