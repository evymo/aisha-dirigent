-- Index: idx_distribution_schedule_date
-- Table: distribution_schedule

CREATE INDEX idx_distribution_schedule_date ON public.distribution_schedule USING btree (scheduled_date);
