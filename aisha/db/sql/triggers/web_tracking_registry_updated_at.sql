-- Trigger: web_tracking_registry_updated_at
-- Source of truth pair: aisha/db/sql/tables/web_tracking_registry.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS web_tracking_registry_updated_at ON public.web_tracking_registry;
CREATE TRIGGER web_tracking_registry_updated_at
  BEFORE UPDATE ON public.web_tracking_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
