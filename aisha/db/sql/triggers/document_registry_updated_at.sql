-- Trigger: document_registry_updated_at
-- Source of truth pair: aisha/db/sql/tables/document_registry.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS document_registry_updated_at ON public.document_registry;
CREATE TRIGGER document_registry_updated_at
  BEFORE UPDATE ON public.document_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
