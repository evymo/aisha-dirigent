-- Trigger: set_instance_endpoint_bindings_updated_at
-- Table: instance_endpoint_bindings

CREATE TRIGGER set_instance_endpoint_bindings_updated_at
    BEFORE UPDATE ON public.instance_endpoint_bindings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
