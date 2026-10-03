-- Trigger: update_schema_version_updated_at
-- Table: schema_version

CREATE TRIGGER update_schema_version_updated_at
    BEFORE UPDATE ON public.schema_version
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
