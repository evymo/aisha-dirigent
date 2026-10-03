-- Trigger: update_node_factory_requests_updated_at
-- Table: node_factory_requests

CREATE TRIGGER update_node_factory_requests_updated_at
BEFORE UPDATE
ON public.node_factory_requests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
