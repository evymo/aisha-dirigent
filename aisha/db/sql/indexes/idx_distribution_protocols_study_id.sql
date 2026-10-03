-- Index: idx_distribution_protocols_study_id
-- Table: distribution_protocols

CREATE INDEX IF NOT EXISTS idx_distribution_protocols_study_id ON public.distribution_protocols(study_id);
