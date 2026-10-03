-- Policy: Authenticated users can view active questions

CREATE POLICY "Authenticated users can view active questions" ON public.test_questions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_active = true) AND (auth.role() = 'authenticated'::text)));
