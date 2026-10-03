-- Policy: design_profiles_service_all
-- Service role has full access to design profiles

CREATE POLICY design_profiles_service_all ON public.design_profiles
  FOR ALL USING (auth.role() = 'service_role');
