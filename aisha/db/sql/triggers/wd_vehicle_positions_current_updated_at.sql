-- Trigger: wd_vehicle_positions_current_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_vehicle_positions_current.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_vehicle_positions_current_updated_at ON public.wd_vehicle_positions_current;
CREATE TRIGGER wd_vehicle_positions_current_updated_at
  BEFORE UPDATE ON public.wd_vehicle_positions_current
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
