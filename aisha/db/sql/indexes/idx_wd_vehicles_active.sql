-- Index: idx_wd_vehicles_active
-- Source of truth pair: aisha/db/sql/tables/wd_vehicles.sql

CREATE INDEX idx_wd_vehicles_active ON public.wd_vehicles (active);
