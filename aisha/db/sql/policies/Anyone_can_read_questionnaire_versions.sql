-- Policy: Anyone can read questionnaire versions

CREATE POLICY "Anyone can read questionnaire versions" ON public.questionnaire_versions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
