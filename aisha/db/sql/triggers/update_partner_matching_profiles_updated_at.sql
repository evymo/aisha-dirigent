-- Trigger: update_partner_matching_profiles_updated_at
-- Table: partner_matching_profiles

CREATE TRIGGER update_partner_matching_profiles_updated_at
    BEFORE UPDATE ON public.partner_matching_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
