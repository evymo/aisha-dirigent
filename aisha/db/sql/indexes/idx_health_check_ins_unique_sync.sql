-- Index: idx_health_check_ins_unique_sync
-- Table: health_check_ins

CREATE UNIQUE INDEX idx_health_check_ins_unique_sync ON public.health_check_ins USING btree (user_id, check_in_date, data_source) WHERE (data_source <> 'manual'::text);
