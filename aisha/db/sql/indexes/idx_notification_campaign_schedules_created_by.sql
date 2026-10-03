-- Index: idx_notification_campaign_schedules_created_by
-- Table: notification_campaign_schedules

CREATE INDEX IF NOT EXISTS idx_notification_campaign_schedules_created_by ON public.notification_campaign_schedules(created_by);
