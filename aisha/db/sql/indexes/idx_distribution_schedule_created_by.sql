-- Index: idx_distribution_schedule_created_by
-- Table: distribution_schedule

CREATE INDEX IF NOT EXISTS idx_distribution_schedule_created_by ON public.distribution_schedule(created_by);
