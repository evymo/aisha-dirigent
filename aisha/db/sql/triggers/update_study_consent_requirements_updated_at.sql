-- Trigger: update_study_consent_requirements_updated_at
-- Table: study_consent_requirements

CREATE TRIGGER update_study_consent_requirements_updated_at
    BEFORE UPDATE ON public.study_consent_requirements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
