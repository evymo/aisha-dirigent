-- Policy: Admins can manage deviations

DROP POLICY IF EXISTS "Admins can manage deviations" ON public.production_deviations;
CREATE POLICY "Admins can manage deviations" ON public.production_deviations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
