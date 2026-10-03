-- Trigger: surface_data_rpcs_updated_at
-- Source of truth pair: aisha/db/sql/tables/surface_data_rpcs.sql
-- Lives in triggers/ (emitted AFTER functions in the baseline) so
-- public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS surface_data_rpcs_updated_at ON public.surface_data_rpcs;
CREATE TRIGGER surface_data_rpcs_updated_at
  BEFORE UPDATE ON public.surface_data_rpcs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
