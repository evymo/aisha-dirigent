-- Policy: Admins can manage parameters

DROP POLICY IF EXISTS "Admins can manage parameters" ON public.growth_policy_parameters;
CREATE POLICY "Admins can manage parameters" ON public.growth_policy_parameters
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
