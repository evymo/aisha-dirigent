-- Index: idx_tc_vehicles_active
-- Source of truth pair: aisha/db/sql/tables/tc_vehicles.sql

CREATE INDEX idx_tc_vehicles_active ON public.tc_vehicles (active);
