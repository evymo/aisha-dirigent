-- Policy: Admins can manage forecasts

DROP POLICY IF EXISTS "Admins can manage forecasts" ON public.distribution_forecasts;
CREATE POLICY "Admins can manage forecasts" ON public.distribution_forecasts
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
