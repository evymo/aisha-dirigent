-- Trigger: ai_runtime_registry_updated_at
-- Source of truth pair: aisha/db/sql/tables/ai_runtime_registry.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER functions
-- in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS ai_runtime_registry_updated_at ON public.ai_runtime_registry;
CREATE TRIGGER ai_runtime_registry_updated_at
  BEFORE UPDATE ON public.ai_runtime_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
