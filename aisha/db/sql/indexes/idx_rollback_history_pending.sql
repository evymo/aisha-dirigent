-- Index: idx_rollback_history_pending

CREATE INDEX IF NOT EXISTS idx_rollback_history_pending
  ON public.rollback_history (approval_status)
  WHERE approval_status = 'pending';
