-- Trigger: surface_section_overrides_updated_at
-- Source of truth pair: aisha/db/sql/tables/surface_section_overrides.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.
--
-- Navíc tu updated_at nese druhou roli: optimistický zámek admin RPC
-- (p_expected_updated_at). Kdyby ho udržoval jen zapisovatel, souběžná úprava
-- odjinud by zámek tiše obešla.

DROP TRIGGER IF EXISTS surface_section_overrides_updated_at ON public.surface_section_overrides;
CREATE TRIGGER surface_section_overrides_updated_at
  BEFORE UPDATE ON public.surface_section_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
