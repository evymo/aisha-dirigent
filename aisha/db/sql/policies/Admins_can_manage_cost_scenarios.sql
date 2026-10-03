-- Policy: Admins can manage cost scenarios

DROP POLICY IF EXISTS "Admins can manage cost scenarios" ON public.production_cost_scenarios;
CREATE POLICY "Admins can manage cost scenarios" ON public.production_cost_scenarios
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
