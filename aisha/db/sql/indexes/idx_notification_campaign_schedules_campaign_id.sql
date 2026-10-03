-- Index: idx_notification_campaign_schedules_campaign_id
-- Table: notification_campaign_schedules

CREATE INDEX idx_notification_campaign_schedules_campaign_id
ON public.notification_campaign_schedules USING btree (campaign_id);
