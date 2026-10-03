-- Index: idx_notification_logs_type_created
-- Table: notification_logs

CREATE INDEX idx_notification_logs_type_created ON public.notification_logs USING btree (notification_type, created_at DESC);
