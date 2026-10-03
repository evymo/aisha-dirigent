-- Policy: Users can create own orders

CREATE POLICY "Users can create own orders" ON public.orders
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
