-- Policy: No access for any user

CREATE POLICY "No access for any user" ON public.sms_otp_codes
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (false);
