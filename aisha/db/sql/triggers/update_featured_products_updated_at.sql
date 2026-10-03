-- Trigger: update_featured_products_updated_at
-- Table: featured_products

CREATE TRIGGER update_featured_products_updated_at
    BEFORE UPDATE ON public.featured_products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
