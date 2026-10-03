-- Trigger: update_production_suppliers_updated_at
-- Table: production_suppliers

CREATE TRIGGER update_production_suppliers_updated_at
    BEFORE UPDATE ON public.production_suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
