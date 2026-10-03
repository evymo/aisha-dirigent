-- Trigger: contract_register_updated_at
-- Source of truth pair: aisha/db/sql/tables/contract_register.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS contract_register_updated_at ON public.contract_register;
CREATE TRIGGER contract_register_updated_at
  BEFORE UPDATE ON public.contract_register
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
