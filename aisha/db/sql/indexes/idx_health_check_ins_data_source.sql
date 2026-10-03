-- Index: idx_health_check_ins_data_source
-- Table: health_check_ins

CREATE INDEX idx_health_check_ins_data_source ON public.health_check_ins USING btree (data_source);
