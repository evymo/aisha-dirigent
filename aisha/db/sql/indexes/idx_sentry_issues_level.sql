-- Index: idx_sentry_issues_level
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_sentry_issues_level ON public.sentry_project_issues(level);
