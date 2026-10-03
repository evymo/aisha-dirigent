-- Policy: design_profiles_admin_all
-- Admin/staff have full access to design profiles

DROP POLICY IF EXISTS design_profiles_admin_all ON public.design_profiles;
CREATE POLICY design_profiles_admin_all ON public.design_profiles
  FOR ALL USING ((SELECT is_admin_or_staff()));
