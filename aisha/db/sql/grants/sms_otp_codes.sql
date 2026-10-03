-- Grants: sms_otp_codes
-- Edge-managed OTP storage must stay service-role only.

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sms_otp_codes TO service_role;
