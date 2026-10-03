-- Trigger: acs_message_schemas_updated_at
-- Source of truth pair: aisha/db/sql/tables/acs_message_schemas.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.
DROP TRIGGER IF EXISTS acs_message_schemas_updated_at ON public.acs_message_schemas;
CREATE TRIGGER acs_message_schemas_updated_at
  BEFORE UPDATE ON public.acs_message_schemas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
