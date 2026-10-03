-- Index: idx_health_check_ins_user_date_desc
-- Table: health_check_ins

CREATE INDEX idx_health_check_ins_user_date_desc ON public.health_check_ins USING btree (user_id, check_in_date DESC);
