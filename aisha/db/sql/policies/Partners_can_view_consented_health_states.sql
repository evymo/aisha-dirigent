-- Policy: Partners can view consented health states

CREATE POLICY "Partners can view consented health states" ON public.member_health_states
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_data_sharing_consent(user_id, auth.uid()));
