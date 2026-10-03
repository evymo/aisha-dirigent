-- Trigger: update_production_capa_updated_at
-- Table: production_capa

CREATE TRIGGER update_production_capa_updated_at
    BEFORE UPDATE ON public.production_capa
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
