-- Index: idx_github_app_repos_installation
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_github_app_repos_installation
  ON public.github_app_repositories (installation_id) WHERE is_active;
