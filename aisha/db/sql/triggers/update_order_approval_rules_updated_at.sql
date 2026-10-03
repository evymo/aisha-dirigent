-- Trigger: update_order_approval_rules_updated_at
-- Table: order_approval_rules

CREATE TRIGGER update_order_approval_rules_updated_at
    BEFORE UPDATE ON public.order_approval_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
