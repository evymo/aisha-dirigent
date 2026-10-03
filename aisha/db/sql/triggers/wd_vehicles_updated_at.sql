-- Trigger: wd_vehicles_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_vehicles.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_vehicles_updated_at ON public.wd_vehicles;
CREATE TRIGGER wd_vehicles_updated_at
  BEFORE UPDATE ON public.wd_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
