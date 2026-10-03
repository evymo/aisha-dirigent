-- Policy: Users can view own lab test orders

CREATE POLICY "Users can view own lab test orders" ON public.lab_test_orders
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id));
