-- Trigger: update_study_blinding_config_updated_at
-- Table: study_blinding_config

CREATE TRIGGER update_study_blinding_config_updated_at
    BEFORE UPDATE ON public.study_blinding_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
