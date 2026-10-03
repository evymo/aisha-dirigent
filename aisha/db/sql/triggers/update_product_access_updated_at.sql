-- Trigger: update_product_access_updated_at
-- Table: product_access

CREATE TRIGGER update_product_access_updated_at
    BEFORE UPDATE ON public.product_access
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
