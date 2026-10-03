-- Index: idx_health_check_ins_date
-- Table: health_check_ins

CREATE INDEX idx_health_check_ins_date ON public.health_check_ins USING btree (check_in_date);
