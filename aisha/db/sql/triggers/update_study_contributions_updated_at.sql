-- Trigger: update_study_contributions_updated_at
-- Table: study_contributions

CREATE TRIGGER update_study_contributions_updated_at
    BEFORE UPDATE ON public.study_contributions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
