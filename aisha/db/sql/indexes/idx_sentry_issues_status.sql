-- Index: idx_sentry_issues_status
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_sentry_issues_status ON public.sentry_project_issues(status);
