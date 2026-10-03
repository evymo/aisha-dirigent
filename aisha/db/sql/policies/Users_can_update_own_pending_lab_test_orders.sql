-- Policy: Users can update own pending lab test orders

CREATE POLICY "Users can update own pending lab test orders" ON public.lab_test_orders
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((auth.uid() = user_id) AND (status = 'pending'::text)))
  WITH CHECK ((auth.uid() = user_id));
