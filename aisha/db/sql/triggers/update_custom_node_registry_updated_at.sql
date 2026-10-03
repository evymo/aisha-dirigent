-- Trigger: update_custom_node_registry_updated_at
-- Table: custom_node_registry

CREATE TRIGGER update_custom_node_registry_updated_at
BEFORE UPDATE
ON public.custom_node_registry
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
