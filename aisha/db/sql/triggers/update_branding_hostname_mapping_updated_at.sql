-- Trigger: update_branding_hostname_mapping_updated_at
-- Table: branding_hostname_mapping

CREATE TRIGGER update_branding_hostname_mapping_updated_at
    BEFORE UPDATE ON public.branding_hostname_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
