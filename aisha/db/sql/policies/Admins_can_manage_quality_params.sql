-- Policy: Admins can manage quality params

DROP POLICY IF EXISTS "Admins can manage quality params" ON public.production_quality_params;
CREATE POLICY "Admins can manage quality params" ON public.production_quality_params
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
