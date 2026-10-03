-- Policy: service_role_manage_repos
-- Table: github_app_repositories

CREATE POLICY "service_role_manage_repos" ON public.github_app_repositories
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
