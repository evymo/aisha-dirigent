-- Index: idx_openclaw_notifications_retry
-- Retry pickup — failed rows scheduled for next attempt window.

CREATE INDEX IF NOT EXISTS idx_openclaw_notifications_retry
  ON public.openclaw_notifications (next_retry_at NULLS FIRST)
  WHERE status = 'failed' AND attempt_count < max_attempts;
