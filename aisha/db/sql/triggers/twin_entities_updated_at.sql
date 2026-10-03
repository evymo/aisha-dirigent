-- Trigger: twin_entities_updated_at
-- Source of truth pair: aisha/db/sql/tables/twin_entities.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS twin_entities_updated_at ON public.twin_entities;
CREATE TRIGGER twin_entities_updated_at
  BEFORE UPDATE ON public.twin_entities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
