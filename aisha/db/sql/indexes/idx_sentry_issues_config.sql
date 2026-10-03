-- Index: idx_sentry_issues_config
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_sentry_issues_config ON public.sentry_project_issues(config_id);
