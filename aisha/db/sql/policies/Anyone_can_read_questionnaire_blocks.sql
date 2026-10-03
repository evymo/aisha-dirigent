-- Policy: Anyone can read questionnaire blocks

CREATE POLICY "Anyone can read questionnaire blocks" ON public.questionnaire_blocks
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
