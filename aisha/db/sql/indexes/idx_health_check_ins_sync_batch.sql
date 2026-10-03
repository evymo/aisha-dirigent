-- Index: idx_health_check_ins_sync_batch
-- Table: health_check_ins

CREATE INDEX idx_health_check_ins_sync_batch ON public.health_check_ins USING btree (sync_batch_id) WHERE (sync_batch_id IS NOT NULL);
