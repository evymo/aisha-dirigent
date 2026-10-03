-- Index: idx_notification_campaign_schedules_next_run
-- Table: notification_campaign_schedules

CREATE INDEX idx_notification_campaign_schedules_next_run
ON public.notification_campaign_schedules USING btree (status, next_run_at);
