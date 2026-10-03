-- Trigger: wd_driver_stats_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_driver_stats.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_driver_stats_updated_at ON public.wd_driver_stats;
CREATE TRIGGER wd_driver_stats_updated_at
  BEFORE UPDATE ON public.wd_driver_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
