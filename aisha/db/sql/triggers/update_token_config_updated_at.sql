-- Trigger: update_token_config_updated_at
-- Table: token_config

CREATE TRIGGER update_token_config_updated_at
    BEFORE UPDATE ON public.token_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
