-- Policy: Users can view own orders

CREATE POLICY "Users can view own orders" ON public.orders
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
