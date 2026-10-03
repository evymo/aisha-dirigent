-- Trigger: update_studies_updated_at
-- Table: studies

CREATE TRIGGER update_studies_updated_at
    BEFORE UPDATE ON public.studies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
