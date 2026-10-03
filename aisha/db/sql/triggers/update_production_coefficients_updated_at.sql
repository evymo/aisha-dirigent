-- Trigger: update_production_coefficients_updated_at
-- Table: production_coefficients

CREATE TRIGGER update_production_coefficients_updated_at
    BEFORE UPDATE ON public.production_coefficients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
