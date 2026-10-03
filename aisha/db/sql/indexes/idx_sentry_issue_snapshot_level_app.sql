-- Index: idx_sentry_issue_snapshot_level_app

CREATE INDEX IF NOT EXISTS idx_sentry_issue_snapshot_level_app
  ON public.sentry_issue_snapshot (app_name, level, first_seen DESC);
