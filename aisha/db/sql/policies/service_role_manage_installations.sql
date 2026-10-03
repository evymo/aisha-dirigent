-- Policy: service_role_manage_installations
-- Table: github_app_installations

CREATE POLICY "service_role_manage_installations" ON public.github_app_installations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
