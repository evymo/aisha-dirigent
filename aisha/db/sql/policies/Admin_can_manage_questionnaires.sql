-- Policy: Admin can manage questionnaires

DROP POLICY IF EXISTS "Admin can manage questionnaires" ON public.study_questionnaires;
CREATE POLICY "Admin can manage questionnaires" ON public.study_questionnaires
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
