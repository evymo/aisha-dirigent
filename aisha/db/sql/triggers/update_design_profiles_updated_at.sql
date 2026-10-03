-- Trigger: update_design_profiles_updated_at
-- Table: design_profiles

CREATE TRIGGER update_design_profiles_updated_at
    BEFORE UPDATE ON public.design_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
