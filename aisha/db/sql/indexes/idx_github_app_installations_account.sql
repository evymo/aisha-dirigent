-- Index: idx_github_app_installations_account
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_github_app_installations_account
  ON public.github_app_installations (account_login);
