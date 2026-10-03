-- Index: idx_vial_assignments_study_id
-- Table: vial_assignments

CREATE INDEX IF NOT EXISTS idx_vial_assignments_study_id ON public.vial_assignments(study_id);
