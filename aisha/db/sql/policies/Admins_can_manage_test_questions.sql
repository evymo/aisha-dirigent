-- Policy: Admins can manage test questions

DROP POLICY IF EXISTS "Admins can manage test questions" ON public.test_questions;
CREATE POLICY "Admins can manage test questions" ON public.test_questions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
