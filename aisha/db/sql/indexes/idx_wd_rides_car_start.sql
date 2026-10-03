-- Index: idx_wd_rides_car_start
-- Source of truth pair: aisha/db/sql/tables/wd_rides.sql

CREATE INDEX idx_wd_rides_car_start
  ON public.wd_rides (wd_car_id, start_time DESC);
