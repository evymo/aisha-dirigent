-- Trigger: update_production_quality_params_updated_at
-- Table: production_quality_params

CREATE TRIGGER update_production_quality_params_updated_at
    BEFORE UPDATE ON public.production_quality_params
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
