-- Trigger: update_study_consultants_updated_at
-- Table: study_consultants

CREATE TRIGGER update_study_consultants_updated_at
    BEFORE UPDATE ON public.study_consultants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
