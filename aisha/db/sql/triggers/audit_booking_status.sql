-- Trigger: audit_booking_status
-- Table: consultation_bookings

CREATE TRIGGER audit_booking_status
    AFTER UPDATE ON public.consultation_bookings
    FOR EACH ROW
    EXECUTE FUNCTION audit_booking_status_change();

