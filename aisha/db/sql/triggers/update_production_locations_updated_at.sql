-- Trigger: update_production_locations_updated_at
-- Table: production_locations

CREATE TRIGGER update_production_locations_updated_at
    BEFORE UPDATE ON public.production_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
