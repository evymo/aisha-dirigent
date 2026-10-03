-- Index: idx_health_sync_log_batch_id
-- Table: health_data_sync_log

CREATE INDEX idx_health_sync_log_batch_id ON public.health_data_sync_log USING btree (sync_batch_id);
