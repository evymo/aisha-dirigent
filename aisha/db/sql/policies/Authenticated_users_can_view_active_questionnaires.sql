-- Policy: Authenticated users can view active questionnaires

CREATE POLICY "Authenticated users can view active questionnaires" ON public.questionnaires
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_active = true) AND (auth.role() = 'authenticated'::text)));
