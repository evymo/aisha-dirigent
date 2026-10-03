-- Index: wd_overspeed_car_time_idx
-- Source of truth pair: aisha/db/sql/tables/wd_overspeed.sql
--
-- Přesunuto z tabulkového souboru 2026-09-05: `aisha/db/sql/tables/`
-- nese JEN `CREATE TABLE` (test `sql-source-separation`). Rozdělení
-- není kosmetika — složky určují POŘADÍ, ve kterém se schéma skládá,
-- a index schovaný v tabulce to pořadí obchází.

CREATE INDEX IF NOT EXISTS wd_overspeed_car_time_idx ON public.wd_overspeed (wd_car_id, time_from);
