-- Trigger: update_lab_test_orders_updated_at
-- Table: lab_test_orders

CREATE TRIGGER update_lab_test_orders_updated_at
    BEFORE UPDATE ON public.lab_test_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
