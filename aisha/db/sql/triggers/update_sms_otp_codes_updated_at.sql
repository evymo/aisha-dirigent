-- Trigger: update_sms_otp_codes_updated_at
-- Table: sms_otp_codes

CREATE TRIGGER update_sms_otp_codes_updated_at
    BEFORE UPDATE ON public.sms_otp_codes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
