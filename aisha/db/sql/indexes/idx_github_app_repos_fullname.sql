-- Index: idx_github_app_repos_fullname
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_github_app_repos_fullname
  ON public.github_app_repositories (repo_full_name);
