-- Index: idx_sms_otp_codes_expires
-- Table: sms_otp_codes

CREATE INDEX IF NOT EXISTS idx_sms_otp_codes_expires
  ON public.sms_otp_codes(expires_at);
