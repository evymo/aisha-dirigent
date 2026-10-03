-- Index: idx_distribution_schedule_status
-- Table: distribution_schedule

CREATE INDEX idx_distribution_schedule_status ON public.distribution_schedule USING btree (status);
