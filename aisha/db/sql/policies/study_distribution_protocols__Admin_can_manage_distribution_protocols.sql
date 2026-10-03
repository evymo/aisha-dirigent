-- Policy: Admin can manage distribution protocols

DROP POLICY IF EXISTS "Admin can manage distribution protocols" ON public.study_distribution_protocols;
CREATE POLICY "Admin can manage distribution protocols" ON public.study_distribution_protocols
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
