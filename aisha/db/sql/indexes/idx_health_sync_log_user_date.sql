-- Index: idx_health_sync_log_user_date
-- Table: health_data_sync_log

CREATE INDEX idx_health_sync_log_user_date ON public.health_data_sync_log USING btree (user_id, created_at DESC);
