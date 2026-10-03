-- Index: idx_health_sync_log_created_at
-- Table: health_data_sync_log

CREATE INDEX idx_health_sync_log_created_at ON public.health_data_sync_log USING btree (created_at DESC);
