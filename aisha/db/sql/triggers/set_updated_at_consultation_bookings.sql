-- Trigger: set_updated_at_consultation_bookings
-- Table: consultation_bookings

CREATE TRIGGER set_updated_at_consultation_bookings
    BEFORE UPDATE ON public.consultation_bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

