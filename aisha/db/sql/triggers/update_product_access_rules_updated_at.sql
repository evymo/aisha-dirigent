-- Trigger: update_product_access_rules_updated_at
-- Table: product_access_rules

CREATE TRIGGER update_product_access_rules_updated_at
    BEFORE UPDATE ON public.product_access_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
