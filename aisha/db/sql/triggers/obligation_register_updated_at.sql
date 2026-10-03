-- Trigger: obligation_register_updated_at
-- Source of truth pair: aisha/db/sql/tables/obligation_register.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS obligation_register_updated_at ON public.obligation_register;
CREATE TRIGGER obligation_register_updated_at
  BEFORE UPDATE ON public.obligation_register
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
