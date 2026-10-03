-- Trigger: knock_device_credentials_updated_at
-- Source of truth pair: aisha/db/sql/tables/knock_device_credentials.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.
DROP TRIGGER IF EXISTS knock_device_credentials_updated_at ON public.knock_device_credentials;
CREATE TRIGGER knock_device_credentials_updated_at
  BEFORE UPDATE ON public.knock_device_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
