-- Policy: Admins can view all health metrics

DROP POLICY IF EXISTS "Admins can view all health metrics" ON public.health_metrics;
CREATE POLICY "Admins can view all health metrics" ON public.health_metrics
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
