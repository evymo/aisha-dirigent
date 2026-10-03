-- Trigger: update_branding_profiles_updated_at
-- Table: branding_profiles

CREATE TRIGGER update_branding_profiles_updated_at
    BEFORE UPDATE ON public.branding_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
