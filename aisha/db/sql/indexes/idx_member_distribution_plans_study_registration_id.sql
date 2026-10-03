-- Index: idx_member_distribution_plans_study_registration_id
-- Table: member_distribution_plans

CREATE INDEX IF NOT EXISTS idx_member_distribution_plans_study_registration_id ON public.member_distribution_plans(study_registration_id);
