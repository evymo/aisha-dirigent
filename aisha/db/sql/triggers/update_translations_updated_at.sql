-- Trigger: update_translations_updated_at
-- Table: translations

CREATE TRIGGER update_translations_updated_at
    BEFORE UPDATE ON public.translations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
