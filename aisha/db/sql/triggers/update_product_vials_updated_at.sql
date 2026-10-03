-- Trigger: update_product_vials_updated_at
-- Table: product_vials

CREATE TRIGGER update_product_vials_updated_at
    BEFORE UPDATE ON public.product_vials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
