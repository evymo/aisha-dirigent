-- Trigger: federated_source_sessions_updated_at
-- Source of truth pair: aisha/db/sql/tables/federated_source_sessions.sql
-- Lives in triggers/ (emitted AFTER functions) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS federated_source_sessions_updated_at ON public.federated_source_sessions;
CREATE TRIGGER federated_source_sessions_updated_at
  BEFORE UPDATE ON public.federated_source_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
