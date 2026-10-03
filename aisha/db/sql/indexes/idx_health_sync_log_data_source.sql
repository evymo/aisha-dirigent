-- Index: idx_health_sync_log_data_source
-- Table: health_data_sync_log

CREATE INDEX idx_health_sync_log_data_source ON public.health_data_sync_log USING btree (data_source);
