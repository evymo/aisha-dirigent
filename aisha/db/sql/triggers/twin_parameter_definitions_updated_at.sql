-- Trigger: twin_parameter_definitions_updated_at
-- Source of truth pair: aisha/db/sql/tables/twin_parameter_definitions.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS twin_parameter_definitions_updated_at ON public.twin_parameter_definitions;
CREATE TRIGGER twin_parameter_definitions_updated_at
  BEFORE UPDATE ON public.twin_parameter_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
