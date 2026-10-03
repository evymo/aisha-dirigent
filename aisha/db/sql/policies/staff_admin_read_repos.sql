-- Policy: staff_admin_read_repos
-- Table: github_app_repositories

DROP POLICY IF EXISTS "staff_admin_read_repos" ON public.github_app_repositories;
CREATE POLICY "staff_admin_read_repos" ON public.github_app_repositories
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
