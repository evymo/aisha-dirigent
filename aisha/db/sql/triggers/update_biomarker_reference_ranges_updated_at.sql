-- Trigger: update_biomarker_reference_ranges_updated_at
-- Table: biomarker_reference_ranges

CREATE TRIGGER update_biomarker_reference_ranges_updated_at
    BEFORE UPDATE ON public.biomarker_reference_ranges
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
