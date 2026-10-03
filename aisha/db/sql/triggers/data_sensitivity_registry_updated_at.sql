-- Trigger: data_sensitivity_registry_updated_at
-- Source of truth pair: aisha/db/sql/tables/data_sensitivity_registry.sql
-- Keeps updated_at fresh when an operator reclassifies a table. Lives in
-- triggers/ (emitted AFTER functions in the baseline) so public.set_updated_at()
-- exists when it binds — inline-in-table placement breaks cold-start ordering.

DROP TRIGGER IF EXISTS data_sensitivity_registry_updated_at ON public.data_sensitivity_registry;
CREATE TRIGGER data_sensitivity_registry_updated_at
  BEFORE UPDATE ON public.data_sensitivity_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
