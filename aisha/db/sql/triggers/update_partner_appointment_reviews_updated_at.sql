-- Trigger: update_partner_appointment_reviews_updated_at
-- Table: partner_appointment_reviews

CREATE TRIGGER update_partner_appointment_reviews_updated_at
    BEFORE UPDATE ON public.partner_appointment_reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
