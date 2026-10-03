-- Policy: Partners can view consented product logs

CREATE POLICY "Partners can view consented product logs" ON public.member_product_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_data_sharing_consent(user_id, auth.uid()));
