-- Index: idx_notification_campaign_runs_campaign_id
-- Table: notification_campaign_runs

CREATE INDEX idx_notification_campaign_runs_campaign_id
ON public.notification_campaign_runs USING btree (campaign_id);
