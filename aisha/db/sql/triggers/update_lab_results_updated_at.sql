-- Trigger: update_lab_results_updated_at
-- Table: lab_results

CREATE TRIGGER update_lab_results_updated_at
    BEFORE UPDATE ON public.lab_results
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
