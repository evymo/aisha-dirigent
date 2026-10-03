-- Index: idx_wd_rides_in_progress
-- Source of truth pair: aisha/db/sql/tables/wd_rides.sql

CREATE INDEX idx_wd_rides_in_progress
  ON public.wd_rides (wd_car_id)
  WHERE end_time IS NULL;
