-- Trigger: wd_rides_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_rides.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_rides_updated_at ON public.wd_rides;
CREATE TRIGGER wd_rides_updated_at
  BEFORE UPDATE ON public.wd_rides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
