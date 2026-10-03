-- Trigger: update_production_equipment_updated_at
-- Table: production_equipment

CREATE TRIGGER update_production_equipment_updated_at
    BEFORE UPDATE ON public.production_equipment
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
