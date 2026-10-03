-- Trigger: update_production_variants_updated_at
-- Table: production_variants

CREATE TRIGGER update_production_variants_updated_at
    BEFORE UPDATE ON public.production_variants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
