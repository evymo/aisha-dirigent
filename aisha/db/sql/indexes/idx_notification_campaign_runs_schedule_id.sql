-- Index: idx_notification_campaign_runs_schedule_id
-- Table: notification_campaign_runs

CREATE INDEX IF NOT EXISTS idx_notification_campaign_runs_schedule_id ON public.notification_campaign_runs(schedule_id);
