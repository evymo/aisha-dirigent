-- Policy: Users can create own lab test orders

CREATE POLICY "Users can create own lab test orders" ON public.lab_test_orders
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id));
