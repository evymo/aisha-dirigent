-- Trigger: update_production_qc_test_definitions_updated_at
-- Table: production_qc_test_definitions

CREATE TRIGGER update_production_qc_test_definitions_updated_at
    BEFORE UPDATE ON public.production_qc_test_definitions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
