-- Trigger: update_consent_templates_updated_at
-- Table: consent_templates

CREATE TRIGGER update_consent_templates_updated_at
    BEFORE UPDATE ON public.consent_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
