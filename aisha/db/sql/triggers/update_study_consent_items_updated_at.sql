-- Trigger: update_study_consent_items_updated_at
-- Table: study_consent_items

CREATE TRIGGER update_study_consent_items_updated_at
    BEFORE UPDATE ON public.study_consent_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
