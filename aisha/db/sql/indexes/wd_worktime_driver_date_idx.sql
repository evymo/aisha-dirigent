-- Index: wd_worktime_driver_date_idx
-- Source of truth pair: aisha/db/sql/tables/wd_worktime.sql
--
-- Přesunuto z tabulkového souboru 2026-09-05: `aisha/db/sql/tables/`
-- nese JEN `CREATE TABLE` (test `sql-source-separation`). Rozdělení
-- není kosmetika — složky určují POŘADÍ, ve kterém se schéma skládá,
-- a index schovaný v tabulce to pořadí obchází.

CREATE INDEX IF NOT EXISTS wd_worktime_driver_date_idx ON public.wd_worktime (wd_driver_id, work_date);
