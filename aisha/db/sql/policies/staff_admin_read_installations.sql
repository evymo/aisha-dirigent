-- Policy: staff_admin_read_installations
-- Table: github_app_installations

DROP POLICY IF EXISTS "staff_admin_read_installations" ON public.github_app_installations;
CREATE POLICY "staff_admin_read_installations" ON public.github_app_installations
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
