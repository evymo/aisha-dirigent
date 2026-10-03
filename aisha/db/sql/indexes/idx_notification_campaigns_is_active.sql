-- Index: idx_notification_campaigns_is_active
-- Table: notification_campaigns

CREATE INDEX idx_notification_campaigns_is_active
ON public.notification_campaigns USING btree (is_active);
