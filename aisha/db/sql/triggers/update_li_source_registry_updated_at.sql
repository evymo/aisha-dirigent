-- Trigger: update_li_source_registry_updated_at
-- Table: li_source_registry

CREATE TRIGGER update_li_source_registry_updated_at
    BEFORE UPDATE ON public.li_source_registry
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
