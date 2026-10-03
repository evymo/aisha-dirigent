-- Index: idx_study_registrations_consultant_id
-- Table: study_registrations

CREATE INDEX IF NOT EXISTS idx_study_registrations_consultant_id ON public.study_registrations(consultant_id);
