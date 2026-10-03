-- Trigger: agent_live_sessions_updated_at
-- Source of truth pair: aisha/db/sql/tables/agent_live_sessions.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds —
-- inline-in-table placement breaks cold-start ordering (tables precede functions).

DROP TRIGGER IF EXISTS agent_live_sessions_updated_at ON public.agent_live_sessions;
CREATE TRIGGER agent_live_sessions_updated_at
  BEFORE UPDATE ON public.agent_live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
