-- Index: idx_data_sharing_consents_study_id
-- Table: data_sharing_consents

CREATE INDEX IF NOT EXISTS idx_data_sharing_consents_study_id ON public.data_sharing_consents(study_id);
