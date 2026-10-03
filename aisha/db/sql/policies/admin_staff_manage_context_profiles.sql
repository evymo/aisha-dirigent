-- Policy: admin_staff_manage_context_profiles

DROP POLICY IF EXISTS "admin_staff_manage_context_profiles" ON public.context_profiles;
CREATE POLICY "admin_staff_manage_context_profiles" ON public.context_profiles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
