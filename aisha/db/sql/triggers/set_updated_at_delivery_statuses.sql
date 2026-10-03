-- Trigger: set_updated_at_delivery_statuses
-- Table: delivery_statuses

CREATE TRIGGER set_updated_at_delivery_statuses
    BEFORE UPDATE ON public.delivery_statuses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
