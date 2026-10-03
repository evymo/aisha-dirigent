-- Index: idx_study_consultants_approved_by
-- Table: study_consultants

CREATE INDEX IF NOT EXISTS idx_study_consultants_approved_by ON public.study_consultants(approved_by);
