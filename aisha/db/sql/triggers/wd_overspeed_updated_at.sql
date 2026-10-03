-- Trigger: wd_overspeed_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_overspeed.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_overspeed_updated_at ON public.wd_overspeed;
CREATE TRIGGER wd_overspeed_updated_at
  BEFORE UPDATE ON public.wd_overspeed
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
