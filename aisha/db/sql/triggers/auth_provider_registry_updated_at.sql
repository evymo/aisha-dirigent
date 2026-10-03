-- Trigger: auth_provider_registry_updated_at
-- Source of truth pair: aisha/db/sql/tables/auth_provider_registry.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS auth_provider_registry_updated_at ON public.auth_provider_registry;
CREATE TRIGGER auth_provider_registry_updated_at
  BEFORE UPDATE ON public.auth_provider_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
