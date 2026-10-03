-- Index: idx_wd_drivers_active
-- Source of truth pair: aisha/db/sql/tables/wd_drivers.sql

CREATE INDEX idx_wd_drivers_active ON public.wd_drivers (active);
