-- Trigger: update_product_label_templates_updated_at
-- Table: product_label_templates

CREATE TRIGGER update_product_label_templates_updated_at
    BEFORE UPDATE ON public.product_label_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
