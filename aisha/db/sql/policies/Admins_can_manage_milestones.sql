-- Policy: Admins can manage milestones

DROP POLICY IF EXISTS "Admins can manage milestones" ON public.production_milestones;
CREATE POLICY "Admins can manage milestones" ON public.production_milestones
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
