-- Trigger: set_graph_nodes_updated_at
-- Keeps graph_nodes.updated_at fresh on every UPDATE. Matches the canonical
-- pattern used by every other AISHA table that exposes updated_at.

CREATE TRIGGER set_graph_nodes_updated_at
  BEFORE UPDATE ON public.graph_nodes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
