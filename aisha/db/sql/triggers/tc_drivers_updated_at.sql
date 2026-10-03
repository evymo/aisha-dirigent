-- Trigger: tc_drivers_updated_at
-- Source of truth pair: aisha/db/sql/tables/tc_drivers.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS tc_drivers_updated_at ON public.tc_drivers;
CREATE TRIGGER tc_drivers_updated_at
  BEFORE UPDATE ON public.tc_drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
