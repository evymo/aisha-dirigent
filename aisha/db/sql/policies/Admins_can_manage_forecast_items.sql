-- Policy: Admins can manage forecast items

DROP POLICY IF EXISTS "Admins can manage forecast items" ON public.distribution_forecast_items;
CREATE POLICY "Admins can manage forecast items" ON public.distribution_forecast_items
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
