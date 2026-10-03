-- Policy: Partners can view consented product plans

CREATE POLICY "Partners can view consented product plans" ON public.member_product_plans
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (has_data_sharing_consent(user_id, auth.uid()));
