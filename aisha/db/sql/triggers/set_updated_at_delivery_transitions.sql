-- Trigger: set_updated_at_delivery_transitions
-- Table: delivery_transitions

CREATE TRIGGER set_updated_at_delivery_transitions
    BEFORE UPDATE ON public.delivery_transitions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
