-- Index: idx_distribution_schedule_processed_by
-- Table: distribution_schedule

CREATE INDEX IF NOT EXISTS idx_distribution_schedule_processed_by ON public.distribution_schedule(processed_by);
