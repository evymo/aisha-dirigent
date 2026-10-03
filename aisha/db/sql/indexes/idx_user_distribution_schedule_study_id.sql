-- Index: idx_user_distribution_schedule_study_id
-- Table: user_distribution_schedule

CREATE INDEX IF NOT EXISTS idx_user_distribution_schedule_study_id ON public.user_distribution_schedule(study_id);
