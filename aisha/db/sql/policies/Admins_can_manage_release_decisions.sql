-- Policy: Admins can manage release decisions

DROP POLICY IF EXISTS "Admins can manage release decisions" ON public.production_release_decisions;
CREATE POLICY "Admins can manage release decisions" ON public.production_release_decisions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
