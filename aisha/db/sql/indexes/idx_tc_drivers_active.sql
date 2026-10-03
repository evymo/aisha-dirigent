-- Index: idx_tc_drivers_active
-- Source of truth pair: aisha/db/sql/tables/tc_drivers.sql

CREATE INDEX idx_tc_drivers_active ON public.tc_drivers (active);
