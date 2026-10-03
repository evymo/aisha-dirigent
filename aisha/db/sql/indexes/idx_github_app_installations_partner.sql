-- Index: idx_github_app_installations_partner
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_github_app_installations_partner
  ON public.github_app_installations (partner_id) WHERE partner_id IS NOT NULL;
