-- Policy: Partners can view consented health logs

CREATE POLICY "Partners can view consented health logs" ON public.member_health_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_data_sharing_consent(user_id, auth.uid()));
