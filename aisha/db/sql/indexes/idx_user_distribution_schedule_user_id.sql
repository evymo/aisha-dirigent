-- Index: idx_user_distribution_schedule_user_id
-- Table: user_distribution_schedule

CREATE INDEX IF NOT EXISTS idx_user_distribution_schedule_user_id ON public.user_distribution_schedule(user_id);
