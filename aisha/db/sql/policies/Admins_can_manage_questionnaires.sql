-- Policy: Admins can manage questionnaires

DROP POLICY IF EXISTS "Admins can manage questionnaires" ON public.questionnaires;
CREATE POLICY "Admins can manage questionnaires" ON public.questionnaires
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
