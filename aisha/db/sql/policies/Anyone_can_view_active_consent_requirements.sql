-- Policy: Anyone can view active consent requirements

CREATE POLICY "Anyone can view active consent requirements" ON public.study_consent_requirements
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
