-- Trigger: update_partner_profiles_updated_at
-- Table: partner_profiles

CREATE TRIGGER update_partner_profiles_updated_at
    BEFORE UPDATE ON public.partner_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
