-- Index: idx_health_check_ins_study_id
-- Table: health_check_ins

CREATE INDEX IF NOT EXISTS idx_health_check_ins_study_id ON public.health_check_ins(study_id);
