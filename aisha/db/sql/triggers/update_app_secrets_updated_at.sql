-- Trigger: update_app_secrets_updated_at
-- Table: app_secrets

CREATE TRIGGER update_app_secrets_updated_at
    BEFORE UPDATE ON public.app_secrets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
