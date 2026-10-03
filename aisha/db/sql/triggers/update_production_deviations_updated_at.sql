-- Trigger: update_production_deviations_updated_at
-- Table: production_deviations

CREATE TRIGGER update_production_deviations_updated_at
    BEFORE UPDATE ON public.production_deviations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
