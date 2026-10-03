-- Trigger: flowboard_graphs_updated_at
-- Source of truth pair: aisha/db/sql/tables/flowboard_graphs.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds —
-- inline-in-table placement breaks cold-start ordering (tables precede functions).

DROP TRIGGER IF EXISTS flowboard_graphs_updated_at ON public.flowboard_graphs;
CREATE TRIGGER flowboard_graphs_updated_at
  BEFORE UPDATE ON public.flowboard_graphs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
