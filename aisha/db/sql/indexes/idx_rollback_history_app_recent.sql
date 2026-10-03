-- Index: idx_rollback_history_app_recent

CREATE INDEX IF NOT EXISTS idx_rollback_history_app_recent
  ON public.rollback_history (app_name, triggered_at DESC);
