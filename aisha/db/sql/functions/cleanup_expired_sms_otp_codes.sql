-- Function: cleanup_expired_sms_otp_codes
-- Description: Removes expired SMS OTP codes (older than 1 hour)
-- Created: 2026-01-24
--
-- Should be called by scheduled job (pg_cron or external scheduler)
-- Example: SELECT public.cleanup_expired_sms_otp_codes();

CREATE OR REPLACE FUNCTION public.cleanup_expired_sms_otp_codes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM sms_otp_codes
  WHERE expires_at < now() - INTERVAL '1 hour';
END;
$$;

-- Grant execute to service_role only (for scheduled jobs)
REVOKE ALL ON FUNCTION public.cleanup_expired_sms_otp_codes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sms_otp_codes() TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_sms_otp_codes() IS 
  'Cleanup expired OTP codes. Should be called by scheduled job.';
