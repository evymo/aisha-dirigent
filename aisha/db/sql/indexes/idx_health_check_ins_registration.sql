-- Index: idx_health_check_ins_registration
-- Table: health_check_ins

CREATE INDEX idx_health_check_ins_registration ON public.health_check_ins USING btree (study_registration_id) WHERE (study_registration_id IS NOT NULL);
