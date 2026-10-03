-- Trigger: update_app_versions_updated_at
-- Table: app_versions

CREATE TRIGGER update_app_versions_updated_at
    BEFORE UPDATE ON public.app_versions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
