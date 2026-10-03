-- Index: idx_member_health_documents_study_registration_id
-- Table: member_health_documents

CREATE INDEX IF NOT EXISTS idx_member_health_documents_study_registration_id ON public.member_health_documents(study_registration_id);
