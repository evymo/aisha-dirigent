-- Trigger: update_production_batch_materials_updated_at
-- Table: production_batch_materials

CREATE TRIGGER update_production_batch_materials_updated_at
    BEFORE UPDATE ON public.production_batch_materials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
