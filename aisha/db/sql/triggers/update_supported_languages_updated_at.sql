-- Trigger: update_supported_languages_updated_at
-- Table: supported_languages

CREATE TRIGGER update_supported_languages_updated_at
    BEFORE UPDATE ON public.supported_languages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
