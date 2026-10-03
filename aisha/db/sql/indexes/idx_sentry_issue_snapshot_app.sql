-- Index: idx_sentry_issue_snapshot_app

CREATE INDEX IF NOT EXISTS idx_sentry_issue_snapshot_app
  ON public.sentry_issue_snapshot (app_name, first_seen DESC);
