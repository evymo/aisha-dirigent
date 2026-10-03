-- Index: idx_wd_rides_driver_start
-- Source of truth pair: aisha/db/sql/tables/wd_rides.sql

CREATE INDEX idx_wd_rides_driver_start
  ON public.wd_rides (wd_driver_id, start_time DESC)
  WHERE wd_driver_id IS NOT NULL;
