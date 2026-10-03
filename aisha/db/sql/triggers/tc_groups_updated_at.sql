-- Trigger: tc_groups_updated_at
-- Source of truth pair: aisha/db/sql/tables/tc_groups.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS tc_groups_updated_at ON public.tc_groups;
CREATE TRIGGER tc_groups_updated_at
  BEFORE UPDATE ON public.tc_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
