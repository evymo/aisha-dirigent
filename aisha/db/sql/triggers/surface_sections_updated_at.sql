-- Trigger: surface_sections_updated_at
-- Source of truth pair: aisha/db/sql/tables/surface_sections.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.
--
-- Držet sloupec triggerem, ne důvěrou v zapisovatele: šablonu píše deploy soubor
-- a override admin RPC, ale sloupec udržovaný jen ručně začne lhát při prvním
-- zápisu odjinud (oprava přes psql, migrace, service_role).

DROP TRIGGER IF EXISTS surface_sections_updated_at ON public.surface_sections;
CREATE TRIGGER surface_sections_updated_at
  BEFORE UPDATE ON public.surface_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
