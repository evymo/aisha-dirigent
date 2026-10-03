-- Policy: Users can view own vouchers

CREATE POLICY "Users can view own vouchers" ON public.product_vouchers
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
