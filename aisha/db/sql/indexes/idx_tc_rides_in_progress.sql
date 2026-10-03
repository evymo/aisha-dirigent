-- Index: idx_tc_rides_in_progress
-- Source of truth pair: aisha/db/sql/tables/tc_rides.sql

CREATE INDEX idx_tc_rides_in_progress ON public.tc_rides (tc_vehicle_id) WHERE end_time IS NULL;
