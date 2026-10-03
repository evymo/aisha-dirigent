-- Policy: Admin can manage contributions

DROP POLICY IF EXISTS "Admin can manage contributions" ON public.study_contributions;
CREATE POLICY "Admin can manage contributions" ON public.study_contributions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
