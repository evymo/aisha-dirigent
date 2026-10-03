-- Trigger: twin_external_refs_updated_at
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS twin_external_refs_updated_at ON public.twin_external_refs;
CREATE TRIGGER twin_external_refs_updated_at
  BEFORE UPDATE ON public.twin_external_refs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
