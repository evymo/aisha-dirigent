-- Policy: Admins can manage cost rates

DROP POLICY IF EXISTS "Admins can manage cost rates" ON public.production_cost_rates;
CREATE POLICY "Admins can manage cost rates" ON public.production_cost_rates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
