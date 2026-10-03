-- Trigger: update_system_config_updated_at
-- Table: system_config

CREATE TRIGGER update_system_config_updated_at
    BEFORE UPDATE ON public.system_config
    FOR EACH ROW
    EXECUTE FUNCTION update_system_config_timestamp();
