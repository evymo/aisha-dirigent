-- Index: idx_github_app_installations_active
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_github_app_installations_active
  ON public.github_app_installations (installation_id) WHERE suspended_at IS NULL;
