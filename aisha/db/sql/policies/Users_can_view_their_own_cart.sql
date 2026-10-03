-- Policy: Users can view their own cart

CREATE POLICY "Users can view their own cart" ON public.cart_items
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
