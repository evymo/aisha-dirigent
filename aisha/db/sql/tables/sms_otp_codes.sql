-- Table: sms_otp_codes
-- Description: Temporary storage for SMS OTP codes (managed by Edge Functions only)
-- Created: 2026-01-24
--
-- Used by Edge Functions:
--   - send-sms-otp: Creates OTP records
--   - verify-sms-otp: Verifies and marks as used
--
-- Security: No RLS policies for authenticated users - only service_role access

CREATE TABLE IF NOT EXISTS public.sms_otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT false,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS (no policies = only service_role can access)
ALTER TABLE public.sms_otp_codes ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE public.sms_otp_codes IS 
  'Temporary storage for SMS OTP codes. Managed by Edge Functions only via service_role.';
COMMENT ON COLUMN public.sms_otp_codes.phone IS 'Phone number in E.164 format (+420123456789)';
COMMENT ON COLUMN public.sms_otp_codes.code_hash IS 'Bcrypt hash of the OTP code (never plaintext)';
COMMENT ON COLUMN public.sms_otp_codes.expires_at IS 'When the OTP expires (default 5 minutes)';
COMMENT ON COLUMN public.sms_otp_codes.verified IS 'Whether the OTP has been verified/used';
COMMENT ON COLUMN public.sms_otp_codes.attempts IS 'Number of verification attempts (max 3)';
