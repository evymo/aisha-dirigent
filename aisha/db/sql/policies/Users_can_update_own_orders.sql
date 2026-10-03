-- Policy: Users can update own orders

CREATE POLICY "Users can update own orders" ON public.orders
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
