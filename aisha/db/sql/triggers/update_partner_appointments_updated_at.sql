-- Trigger: update_partner_appointments_updated_at
-- Table: partner_appointments

CREATE TRIGGER update_partner_appointments_updated_at
    BEFORE UPDATE ON public.partner_appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
