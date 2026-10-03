-- Trigger: update_qualification_results_updated_at
-- Table: qualification_results

CREATE TRIGGER update_qualification_results_updated_at
    BEFORE UPDATE ON public.qualification_results
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
