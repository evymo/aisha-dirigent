-- Index: idx_notification_campaigns_updated_by
-- Table: notification_campaigns

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_updated_by ON public.notification_campaigns(updated_by);
