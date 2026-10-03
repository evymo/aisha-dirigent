-- Index: idx_tc_rides_vehicle_start
-- Source of truth pair: aisha/db/sql/tables/tc_rides.sql

CREATE INDEX idx_tc_rides_vehicle_start ON public.tc_rides (tc_vehicle_id, start_time DESC);
