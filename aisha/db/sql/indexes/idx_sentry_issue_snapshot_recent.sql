-- Index: idx_sentry_issue_snapshot_recent

CREATE INDEX IF NOT EXISTS idx_sentry_issue_snapshot_recent
  ON public.sentry_issue_snapshot (observed_at DESC);
