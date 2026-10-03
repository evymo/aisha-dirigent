-- Policy: Admins can manage metrics

DROP POLICY IF EXISTS "Admins can manage metrics" ON public.production_metrics;
CREATE POLICY "Admins can manage metrics" ON public.production_metrics
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
