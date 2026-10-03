-- Trigger: update_study_questionnaires_updated_at
-- Table: study_questionnaires

CREATE TRIGGER update_study_questionnaires_updated_at
    BEFORE UPDATE ON public.study_questionnaires
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
