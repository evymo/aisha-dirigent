-- RLS Policies for sms_otp_codes
-- INTENTIONALLY NO ACCESS for authenticated/anon users
-- Only service_role (Edge Functions) can access this table
--
-- This is a security measure - OTP codes should never be readable by clients

-- Explicit deny-all policy for documentation and analyzer compliance
-- service_role bypasses RLS and can access the table
-- All other roles (anon, authenticated) are blocked by this policy

CREATE POLICY "No access for any user"
ON sms_otp_codes FOR ALL
USING (false);
