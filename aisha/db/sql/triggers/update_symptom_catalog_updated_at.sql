-- Trigger: update_symptom_catalog_updated_at
-- Table: symptom_catalog

CREATE TRIGGER update_symptom_catalog_updated_at
    BEFORE UPDATE ON public.symptom_catalog
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
