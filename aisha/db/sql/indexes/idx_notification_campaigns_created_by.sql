-- Index: idx_notification_campaigns_created_by
-- Table: notification_campaigns

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_created_by ON public.notification_campaigns(created_by);
