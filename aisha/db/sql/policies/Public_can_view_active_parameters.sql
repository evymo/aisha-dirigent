-- Policy: Public can view active parameters

CREATE POLICY "Public can view active parameters" ON public.growth_policy_parameters
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
