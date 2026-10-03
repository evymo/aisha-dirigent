-- Index: idx_openclaw_notifications_queued
-- Polling index — dispatcher reads queued rows oldest-first every 30s.

CREATE INDEX IF NOT EXISTS idx_openclaw_notifications_queued
  ON public.openclaw_notifications (status, created_at)
  WHERE status = 'queued';
