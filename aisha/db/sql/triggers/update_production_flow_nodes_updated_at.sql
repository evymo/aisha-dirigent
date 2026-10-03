-- Trigger: update_production_flow_nodes_updated_at
-- Table: production_flow_nodes

CREATE TRIGGER update_production_flow_nodes_updated_at
    BEFORE UPDATE ON public.production_flow_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
