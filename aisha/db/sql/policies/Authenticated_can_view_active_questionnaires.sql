-- Policy: Authenticated can view active questionnaires

CREATE POLICY "Authenticated can view active questionnaires" ON public.study_questionnaires
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_active = true) AND (auth.uid() IS NOT NULL)));
