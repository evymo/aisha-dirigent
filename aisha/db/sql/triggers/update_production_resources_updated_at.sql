-- Trigger: update_production_resources_updated_at
-- Table: production_resources

CREATE TRIGGER update_production_resources_updated_at
    BEFORE UPDATE ON public.production_resources
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
