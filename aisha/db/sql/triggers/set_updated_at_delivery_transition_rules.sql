-- Trigger: set_updated_at_delivery_transition_rules
-- Table: delivery_transition_rules

CREATE TRIGGER set_updated_at_delivery_transition_rules
    BEFORE UPDATE ON public.delivery_transition_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
